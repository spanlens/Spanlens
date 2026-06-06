import { describe, expect, it } from 'vitest'
import { mapSpanToEventRow } from './backfill-spans-from-supabase.js'

function span(overrides: Record<string, unknown> = {}) {
  return {
    id: 'spn-1',
    trace_id: 'trc-1',
    parent_span_id: 'spn-0',
    organization_id: 'org-1',
    name: 'llm_judge',
    span_type: 'llm',
    status: 'success',
    started_at: '2026-06-06T00:00:00.000Z',
    ended_at: '2026-06-06T00:00:00.500Z',
    duration_ms: 500,
    input: { prompt: 'Rate this output.' },
    output: { rating: 4 },
    metadata: { judge_model: 'gpt-4o' },
    error_message: null,
    prompt_tokens: 100,
    completion_tokens: 25,
    total_tokens: 125,
    cost_usd: '0.0008',
    created_at: '2026-06-06T00:00:00.000Z',
    ...overrides,
  } as never
}

describe('mapSpanToEventRow', () => {
  it('emits an event_type=span row that links to its trace + parent', () => {
    const row = mapSpanToEventRow(span())
    expect(row['event_id']).toBe('spn-1')
    expect(row['trace_id']).toBe('trc-1')
    expect(row['parent_event_id']).toBe('spn-0')
    expect(row['event_type']).toBe('span')
  })

  it('rolls span_type and status into metadata so the view can read them out', () => {
    const row = mapSpanToEventRow(span())
    expect(row['metadata']).toMatchObject({
      source: 'backfill_spans_from_supabase',
      status: 'success',
      span_type: 'llm',
      judge_model: 'gpt-4o',
    })
  })

  it('writes the historical token map even when one count is zero', () => {
    const row = mapSpanToEventRow(span({ completion_tokens: 0 }))
    expect(row['usage_details']).toEqual({
      prompt_tokens: 100,
      completion_tokens: 0,
      total_tokens: 125,
    })
  })

  it('serialises jsonb input/output to JSON strings for CH', () => {
    const row = mapSpanToEventRow(span())
    expect(row['input']).toBe(JSON.stringify({ prompt: 'Rate this output.' }))
    expect(row['output']).toBe(JSON.stringify({ rating: 4 }))
  })

  it('handles null input/output gracefully (empty string)', () => {
    const row = mapSpanToEventRow(span({ input: null, output: null }))
    expect(row['input']).toBe('')
    expect(row['output']).toBe('')
  })

  it('produces cost_details only when cost is present', () => {
    const noCost = mapSpanToEventRow(span({ cost_usd: null }))
    expect(noCost['total_cost_usd']).toBeNull()
    expect(noCost['cost_details']).toEqual({})

    const withCost = mapSpanToEventRow(span())
    expect(withCost['total_cost_usd']).toBe(0.0008)
    expect(withCost['cost_details']).toEqual({ total_cost_usd: 0.0008 })
  })
})
