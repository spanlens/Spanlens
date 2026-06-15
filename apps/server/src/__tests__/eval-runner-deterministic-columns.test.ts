import { beforeEach, describe, expect, test, vi } from 'vitest'

// P3-14 regression: runSimpleEvalRun (deterministic regex/json_schema path)
// used to write sample_count / aggregate_score / total_tokens to eval_runs —
// columns that do NOT exist on the table. supabaseAdmin is an untyped client,
// so the bad keys compiled and PostgREST silently dropped them, leaving every
// deterministic run displaying "0 scored / no average". These tests pin the
// update payload to the REAL eval_runs columns so the regression can't return.

const supabaseFromMock = vi.fn()
const selectRequestsMock = vi.fn()

vi.mock('../lib/db.js', () => ({
  supabaseAdmin: {
    from: (...args: unknown[]) => supabaseFromMock(...args),
  },
}))

vi.mock('../lib/requests-query.js', () => ({
  requestsScope: async () => ({}),
  selectRequests: (...args: unknown[]) => selectRequestsMock(...args),
}))

let runSimpleEvalRun: typeof import('../lib/eval-runners/deterministic.js').runSimpleEvalRun

// Real columns on eval_runs (supabase/migrations/20260513000000_evals.sql +
// 20260614010000_eval_runs_scoring_counts.sql + 20260615030000_eval_run_score_stddev.sql).
// The update must be a subset.
const REAL_EVAL_RUNS_COLUMNS = new Set([
  'status', 'scored_count', 'attempted_count', 'failed_count',
  'avg_score', 'score_stddev', 'distribution',
  'total_cost_usd', 'error', 'completed_at',
])

let lastUpdatePayload: Record<string, unknown> | null = null
let lastEvalResultsRows: Array<Record<string, unknown>> | null = null

// Real columns on eval_results (20260513000000_evals.sql + later typed-value
// migration). organization_id is NOT NULL; cost is judge_cost_usd/judge_tokens
// (there are no cost_usd/tokens columns).
const REAL_EVAL_RESULTS_COLUMNS = new Set([
  'organization_id', 'eval_run_id', 'request_id', 'dataset_item_id',
  'score', 'reasoning', 'judge_cost_usd', 'judge_tokens', 'score_config_id',
  'value_number', 'value_string', 'value_boolean', 'value_raw_number',
])

beforeEach(async () => {
  vi.resetModules()
  supabaseFromMock.mockReset()
  selectRequestsMock.mockReset()
  lastUpdatePayload = null
  lastEvalResultsRows = null

  supabaseFromMock.mockImplementation((table: string) => {
    if (table === 'eval_results') {
      return {
        insert: (rows: Array<Record<string, unknown>>) => {
          lastEvalResultsRows = rows
          return Promise.resolve({ error: null })
        },
      }
    }
    if (table === 'eval_runs') {
      return {
        update: (payload: Record<string, unknown>) => {
          lastUpdatePayload = payload
          return { eq: vi.fn().mockResolvedValue({ error: null }) }
        },
      }
    }
    return {}
  })

  ;({ runSimpleEvalRun } = await import('../lib/eval-runners/deterministic.js'))
})

function openAiBody(content: string): string {
  return JSON.stringify({ choices: [{ message: { content } }] })
}

describe('runSimpleEvalRun — eval_runs column contract', () => {
  test('writes only real eval_runs columns (never sample_count/aggregate_score/total_tokens)', async () => {
    selectRequestsMock.mockResolvedValue([
      { id: 'req-1', response_body: openAiBody('hello world') },
      { id: 'req-2', response_body: openAiBody('goodbye') },
    ])

    await runSimpleEvalRun('run-1', 'org-1', 'pv-1', 50, null, null, 'regex', { pattern: 'hello' })

    expect(lastUpdatePayload).not.toBeNull()
    const keys = Object.keys(lastUpdatePayload!)
    // The bug columns must be absent.
    expect(keys).not.toContain('sample_count')
    expect(keys).not.toContain('aggregate_score')
    expect(keys).not.toContain('total_tokens')
    // Every key must be a real column.
    for (const k of keys) {
      expect(REAL_EVAL_RUNS_COLUMNS.has(k)).toBe(true)
    }
  })

  test('eval_results rows carry organization_id and judge_cost_usd/judge_tokens (not cost_usd/tokens)', async () => {
    selectRequestsMock.mockResolvedValue([
      { id: 'req-1', response_body: openAiBody('hello world') },
    ])

    await runSimpleEvalRun('run-1', 'org-42', 'pv-1', 50, null, null, 'regex', { pattern: 'hello' })

    expect(lastEvalResultsRows).not.toBeNull()
    expect(lastEvalResultsRows!.length).toBe(1)
    const row = lastEvalResultsRows![0]!
    // organization_id is NOT NULL — omitting it (the prior bug) failed the INSERT.
    expect(row['organization_id']).toBe('org-42')
    // Correct cost columns present, bug columns absent.
    expect(row).toHaveProperty('judge_cost_usd')
    expect(row).toHaveProperty('judge_tokens')
    expect(row).not.toHaveProperty('cost_usd')
    expect(row).not.toHaveProperty('tokens')
    // Every key must be a real eval_results column.
    for (const k of Object.keys(row)) {
      expect(REAL_EVAL_RESULTS_COLUMNS.has(k)).toBe(true)
    }
  })

  test('populates scored/attempted/failed counts and avg_score (pass-rate)', async () => {
    // 'hello' matches req-1 (score 1) but not req-2 (score 0) → avg 0.5.
    selectRequestsMock.mockResolvedValue([
      { id: 'req-1', response_body: openAiBody('hello world') },
      { id: 'req-2', response_body: openAiBody('goodbye') },
    ])

    await runSimpleEvalRun('run-1', 'org-1', 'pv-1', 50, null, null, 'regex', { pattern: 'hello' })

    expect(lastUpdatePayload).toMatchObject({
      status: 'completed',
      scored_count: 2,
      attempted_count: 2,
      failed_count: 0,
      avg_score: 0.5,
      total_cost_usd: 0,
    })
    // P1-7: sample stddev of [1, 0] = sqrt(0.5) ≈ 0.7071 (n-1 corrected).
    expect(lastUpdatePayload!['score_stddev']).toBeCloseTo(Math.sqrt(0.5), 6)
  })

  test('avg_score is null (not 0) when no samples were scored', async () => {
    selectRequestsMock.mockResolvedValue([])

    await runSimpleEvalRun('run-1', 'org-1', 'pv-1', 50, null, null, 'regex', { pattern: 'hello' })

    expect(lastUpdatePayload).toMatchObject({
      scored_count: 0,
      attempted_count: 0,
      failed_count: 0,
      avg_score: null,
    })
  })
})
