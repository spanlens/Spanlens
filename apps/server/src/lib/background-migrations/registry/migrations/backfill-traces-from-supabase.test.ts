import { describe, expect, it } from 'vitest'
import { mapTraceToEventRow } from './backfill-traces-from-supabase.js'

function trace(overrides: Record<string, unknown> = {}) {
  return {
    id: 'trc-1',
    organization_id: 'org-1',
    project_id: 'prj-1',
    api_key_id: 'key-1',
    name: 'eval_run',
    status: 'success',
    started_at: '2026-06-06T00:00:00.000Z',
    ended_at: '2026-06-06T00:00:01.000Z',
    duration_ms: 1000,
    metadata: { source: 'production', evaluator_id: 'evl-1' },
    error_message: null,
    total_tokens: 1500,
    total_cost_usd: '0.0025',
    created_at: '2026-06-06T00:00:00.000Z',
    external_trace_id: null,
    ...overrides,
  } as never
}

describe('mapTraceToEventRow', () => {
  it('emits an event_type=trace row with event_id == trace_id', () => {
    const row = mapTraceToEventRow(trace())
    expect(row['event_id']).toBe('trc-1')
    expect(row['trace_id']).toBe('trc-1')
    expect(row['parent_event_id']).toBeNull()
    expect(row['event_type']).toBe('trace')
  })

  it('tags the metadata source so live writes are distinguishable from backfill', () => {
    const row = mapTraceToEventRow(trace())
    expect(row['metadata']).toMatchObject({
      source: 'backfill_traces_from_supabase',
      status: 'success',
      evaluator_id: 'evl-1',
    })
  })

  it('coerces cost_usd from CH-style string to JS number', () => {
    const row = mapTraceToEventRow(trace({ total_cost_usd: '0.0042' }))
    expect(row['total_cost_usd']).toBe(0.0042)
  })

  it('treats null metadata gracefully', () => {
    const row = mapTraceToEventRow(trace({ metadata: null }))
    expect(row['metadata']).toEqual({
      source: 'backfill_traces_from_supabase',
      status: 'success',
    })
    expect(row['input']).toBe('')
  })

  it('formats start/end times into the CH-friendly shape', () => {
    const row = mapTraceToEventRow(trace())
    expect(row['start_time']).toMatch(/^2026-06-06 00:00:00/)
    expect(row['end_time']).toMatch(/^2026-06-06 00:00:01/)
  })
})
