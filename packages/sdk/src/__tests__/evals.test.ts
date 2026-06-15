import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SpanlensClient } from '../client.js'
import { SpanlensApiError } from '../transport.js'
import { scoreConfidenceInterval, type EvalRun } from '../evals.js'

/**
 * P2-8 SDK contract: client.evals.run() triggers a run and (by default)
 * polls to completion, returning the scored run so CI can gate on it.
 * Blocking + throwing — a failed run must fail the build, and a public
 * key must surface PUBLIC_KEY_WRITE_FORBIDDEN.
 *
 * fetch is stubbed via vi.stubGlobal (vi.spyOn doesn't intercept the SDK's
 * direct global fetch in Node) with a fresh Response per call.
 */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function makeRun(over: Partial<EvalRun>): EvalRun {
  return {
    id: 'run_1',
    organization_id: 'org_1',
    evaluator_id: 'ev_1',
    prompt_version_id: 'pv_1',
    dataset_id: null,
    source: 'production',
    sample_size: 50,
    status: 'pending',
    scored_count: 0,
    attempted_count: 0,
    failed_count: 0,
    avg_score: null,
    score_stddev: null,
    total_cost_usd: 0,
    error: null,
    started_at: '2026-06-14T00:00:00Z',
    completed_at: null,
    ...over,
  }
}

describe('client.evals', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('run() posts the trigger then polls until completed and returns the scored run', async () => {
    fetchMock
      // POST /eval-runs → pending
      .mockResolvedValueOnce(jsonResponse({ success: true, data: makeRun({ status: 'pending' }) }))
      // first poll → running
      .mockResolvedValueOnce(jsonResponse({ success: true, data: makeRun({ status: 'running' }) }))
      // second poll → completed
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: makeRun({ status: 'completed', scored_count: 48, attempted_count: 50, failed_count: 2, avg_score: 0.82 }),
        }),
      )

    const client = new SpanlensClient({ apiKey: 'sl_live_full', baseUrl: 'https://api.test' })
    const run = await client.evals.run(
      { evaluatorId: 'ev_1', promptVersionId: 'pv_1', sampleSize: 50 },
      { pollIntervalMs: 1 },
    )

    expect(run.status).toBe('completed')
    expect(run.avg_score).toBe(0.82)
    expect(run.scored_count).toBe(48)

    // First call is the POST with a camelCase body the server expects.
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.test/api/v1/eval-runs')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer sl_live_full' })
    expect(JSON.parse(init.body as string)).toMatchObject({
      evaluatorId: 'ev_1',
      promptVersionId: 'pv_1',
      source: 'production',
      sampleSize: 50,
    })
    // 1 POST + 2 polls.
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('run({ wait: false }) returns immediately after the trigger', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: makeRun({ status: 'pending' }) }))

    const client = new SpanlensClient({ apiKey: 'sl_live_full', baseUrl: 'https://api.test' })
    const run = await client.evals.run({ evaluatorId: 'ev_1', promptVersionId: 'pv_1' }, { wait: false })

    expect(run.status).toBe('pending')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('run() throws SpanlensApiError when a public key hits the write route', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { error: { code: 'PUBLIC_KEY_WRITE_FORBIDDEN', message: 'Public API key cannot perform write operations.' } },
        403,
      ),
    )

    const client = new SpanlensClient({ apiKey: 'sl_live_pub_xyz', baseUrl: 'https://api.test' })
    await expect(
      client.evals.run({ evaluatorId: 'ev_1', promptVersionId: 'pv_1' }),
    ).rejects.toThrowError(SpanlensApiError)
  })

  it('run() stops polling and returns a failed run (no infinite loop)', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ success: true, data: makeRun({ status: 'pending' }) }))
      .mockResolvedValueOnce(
        jsonResponse({ success: true, data: makeRun({ status: 'failed', error: 'All judge calls failed' }) }),
      )

    const client = new SpanlensClient({ apiKey: 'sl_live_full', baseUrl: 'https://api.test' })
    const run = await client.evals.run({ evaluatorId: 'ev_1', promptVersionId: 'pv_1' }, { pollIntervalMs: 1 })

    expect(run.status).toBe('failed')
    expect(run.error).toContain('failed')
  })

  it('getResults() returns the per-sample rows', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ success: true, data: [{ id: 'r1', eval_run_id: 'run_1', score: 0.4 }] }),
    )

    const client = new SpanlensClient({ apiKey: 'sl_live_full', baseUrl: 'https://api.test' })
    const results = await client.evals.getResults('run_1')

    expect(results).toHaveLength(1)
    expect(results[0]?.score).toBe(0.4)
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toBe('https://api.test/api/v1/eval-runs/run_1/results')
  })
})

// ── P1-7: scoreConfidenceInterval ────────────────────────────────────────────

describe('scoreConfidenceInterval', () => {
  it('computes mean ± 1.96·stddev/√n for a scored run', () => {
    const run = makeRun({ status: 'completed', scored_count: 100, avg_score: 0.8, score_stddev: 0.2 })
    const ci = scoreConfidenceInterval(run)
    expect(ci).not.toBeNull()
    expect(ci!.mean).toBe(0.8)
    expect(ci!.margin).toBeCloseTo(0.0392, 6) // 1.96 * 0.2 / 10
    expect(ci!.low).toBeCloseTo(0.7608, 6)
    expect(ci!.high).toBeCloseTo(0.8392, 6)
  })

  it('clamps the interval to [0, 1]', () => {
    // mean 0.5, stddev 0.6, n 4 → margin = 1.96 * 0.6 / 2 = 0.588, so the raw
    // interval [-0.088, 1.088] clamps to [0, 1].
    const run = makeRun({ status: 'completed', scored_count: 4, avg_score: 0.5, score_stddev: 0.6 })
    const ci = scoreConfidenceInterval(run)!
    expect(ci.margin).toBeCloseTo(0.588, 6)
    expect(ci.low).toBe(0)
    expect(ci.high).toBe(1)
  })

  it('returns null when the run cannot support an interval', () => {
    expect(scoreConfidenceInterval(makeRun({ avg_score: null, score_stddev: 0.2, scored_count: 50 }))).toBeNull()
    expect(scoreConfidenceInterval(makeRun({ avg_score: 0.8, score_stddev: null, scored_count: 50 }))).toBeNull()
    expect(scoreConfidenceInterval(makeRun({ avg_score: 0.8, score_stddev: 0.2, scored_count: 1 }))).toBeNull()
  })
})
