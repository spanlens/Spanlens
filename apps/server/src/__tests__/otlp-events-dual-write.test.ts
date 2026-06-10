import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Sprint 10 R-12 Phase 3.2b — OTLP `/v1/traces` receiver dual-writes to
 * the events store so orgs flipped to `read_from_events` see OTLP
 * traces too. Pre-3.2b they only landed in Postgres and the events
 * read path showed zero OTLP traces.
 *
 * The OTLP path is more constrained than the SDK ingest path:
 *   - events.event_id MUST be UUID, OTLP carries hex span IDs → the
 *     handler pre-assigns a Postgres UUID per span and threads it
 *     through to both INSERT and the events shadow.
 *   - parent_event_id MUST be UUID too → in-batch parent lookup via a
 *     hex→UUID map; cross-batch parents stay null until a follow-up
 *     events-side orphan-link migration.
 *   - Spans the per-row fallback INSERT rejected must NOT appear on
 *     the events side either (the two read paths stay consistent).
 */

const state = vi.hoisted(() => ({
  traceUpsertResult: { data: { id: 'trace-uuid-1' }, error: null } as {
    data: { id: string } | null
    error: { message: string } | null
  },
  /** Per-row INSERT result queue (drained by single-row fallback). */
  spanSingleInsertResults: [] as Array<{ error: { message: string } | null }>,
  /** If true, the initial bulk INSERT fails and the handler falls back to per-row. */
  bulkInsertFails: false,
  /** Captured (table, payload) tuples in INSERT order. */
  insertCalls: [] as Array<{ table: string; payload: unknown }>,
  /** Auth: pretend a full-scope key resolved successfully. */
  apiKeyRow: {
    id: 'apikey-1',
    organization_id: 'org-1',
    scope: 'full',
    project_id: 'project-1',
    api_keys_to_projects: { project_id: 'project-1' },
  } as unknown,
}))

const { writeTraceMock, writeSpanMock } = vi.hoisted(() => ({
  writeTraceMock: vi.fn(async (_input: unknown) => undefined),
  writeSpanMock: vi.fn(async (_input: unknown) => undefined),
}))

vi.mock('../lib/events-writer.js', () => ({
  writeTraceAsEvent: writeTraceMock,
  writeSpanAsEvent: writeSpanMock,
}))

// Bypass auth so we can hit the OTLP handler directly. The middleware
// chain reads c.get(...) for organizationId / projectId / apiKeyId; we
// inject those via a wrapper middleware below.
vi.mock('../middleware/authApiKey.js', async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>
  return {
    ...orig,
    authApiKey: async (
      c: { set: (k: string, v: unknown) => void },
      next: () => Promise<void>,
    ) => {
      c.set('organizationId', 'org-1')
      c.set('projectId', 'project-1')
      c.set('apiKeyId', 'apikey-1')
      await next()
    },
  }
})

vi.mock('../middleware/requireFullScope.js', () => ({
  requireFullScope: async (_c: unknown, next: () => Promise<void>) => {
    await next()
  },
}))

vi.mock('../lib/db.js', () => {
  const buildChain = (table: string, payload: unknown): unknown => {
    state.insertCalls.push({ table, payload })

    if (table === 'traces') {
      const chain = {
        upsert: () => chain,
        insert: () => chain,
        select: () => chain,
        single: async () => state.traceUpsertResult,
      }
      return chain
    }

    if (table === 'spans') {
      // spans.insert is called either with an array (bulk) or a single row.
      const isArray = Array.isArray(payload)
      if (isArray) {
        return {
          // bulk INSERT — no .select chain in the handler
          then: (onFulfilled: (v: { error: { message: string } | null }) => unknown) =>
            Promise.resolve(state.bulkInsertFails ? { error: { message: 'bulk poisoned' } } : { error: null }).then(onFulfilled),
        }
      }
      // single-row fallback INSERT
      const result = state.spanSingleInsertResults.shift() ?? { error: null }
      return {
        then: (onFulfilled: (v: { error: { message: string } | null }) => unknown) =>
          Promise.resolve(result).then(onFulfilled),
      }
    }

    return {}
  }

  const supabaseAdmin = {
    from: (table: string) => ({
      upsert: (payload: unknown) => buildChain(table, payload),
      insert: (payload: unknown) => buildChain(table, payload),
    }),
  }
  return { supabaseAdmin, supabaseClient: {} }
})

import { otlpRouter } from '../api/otlp.js'

const ORG = 'org-1'
const TRACE_ID_HEX = '0123456789abcdef0123456789abcdef'

function makeOtlpBody(spans: Array<{ spanId: string; parentSpanId?: string; name: string }>) {
  return {
    resourceSpans: [
      {
        scopeSpans: [
          {
            spans: spans.map((s) => ({
              traceId: TRACE_ID_HEX,
              spanId: s.spanId,
              parentSpanId: s.parentSpanId ?? '',
              name: s.name,
              kind: 1,
              startTimeUnixNano: '1718000000000000000',
              endTimeUnixNano: '1718000001000000000',
              status: { code: 1 },
              attributes: [
                { key: 'gen_ai.operation.name', value: { stringValue: 'chat' } },
              ],
            })),
          },
        ],
      },
    ],
  }
}

async function postOtlp(body: unknown): Promise<Response> {
  return otlpRouter.request('/v1/traces', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

describe('OTLP /v1/traces — events dual-write (R-12 Phase 3.2b)', () => {
  beforeEach(() => {
    state.traceUpsertResult = { data: { id: 'trace-uuid-1' }, error: null }
    state.spanSingleInsertResults = []
    state.bulkInsertFails = false
    state.insertCalls = []
    writeTraceMock.mockReset()
    writeSpanMock.mockReset()
  })

  it('writes exactly one trace event per OTLP trace group', async () => {
    const res = await postOtlp(makeOtlpBody([{ spanId: 'aaaaaaaaaaaaaaaa', name: 'root' }]))
    expect(res.status).toBe(200)
    expect(writeTraceMock).toHaveBeenCalledTimes(1)
    const traceInput = writeTraceMock.mock.calls[0]![0] as Record<string, unknown>
    expect(traceInput['traceId']).toBe('trace-uuid-1')
    expect(traceInput['organizationId']).toBe(ORG)
    expect(traceInput['name']).toBe('root')
    expect(traceInput['status']).toBe('completed')
  })

  it('uses the Postgres-assigned UUID (not the OTLP hex span ID) as event_id', async () => {
    await postOtlp(makeOtlpBody([{ spanId: 'aaaaaaaaaaaaaaaa', name: 'root' }]))
    expect(writeSpanMock).toHaveBeenCalledTimes(1)
    const spanInput = writeSpanMock.mock.calls[0]![0] as Record<string, unknown>
    expect(spanInput['spanId']).toEqual(expect.stringMatching(UUID_RE))
    expect(spanInput['spanId']).not.toBe('aaaaaaaaaaaaaaaa')
    expect(spanInput['traceId']).toBe('trace-uuid-1')
  })

  it('links in-batch parents via hex→UUID and leaves cross-batch parents null', async () => {
    await postOtlp(
      makeOtlpBody([
        { spanId: 'aaaaaaaaaaaaaaaa', name: 'root' },
        { spanId: 'bbbbbbbbbbbbbbbb', parentSpanId: 'aaaaaaaaaaaaaaaa', name: 'child-in-batch' },
        { spanId: 'cccccccccccccccc', parentSpanId: 'ffffffffffffffff', name: 'child-cross-batch' },
      ]),
    )
    const spanCalls = writeSpanMock.mock.calls.map((c) => c[0] as Record<string, unknown>)
    expect(spanCalls).toHaveLength(3)

    const rootId = spanCalls[0]!['spanId']
    expect(spanCalls[0]!['parentSpanId']).toBeNull() // root

    // Same-batch parent: child references the root's UUID, not the hex span ID.
    const child = spanCalls[1]!
    expect(child['parentSpanId']).toBe(rootId)
    expect(child['parentSpanId']).not.toBe('aaaaaaaaaaaaaaaa')

    // Cross-batch parent: not in this OTLP export → stays null.
    const cross = spanCalls[2]!
    expect(cross['parentSpanId']).toBeNull()
  })

  it('inserts the same UUID into Postgres spans.id and events.event_id', async () => {
    await postOtlp(makeOtlpBody([{ spanId: 'aaaaaaaaaaaaaaaa', name: 'root' }]))
    const spansInsertCall = state.insertCalls.find((c) => c.table === 'spans')!
    const pgRow = (spansInsertCall.payload as Array<{ id: string }>)[0]!
    const eventSpanId = (writeSpanMock.mock.calls[0]![0] as Record<string, unknown>)['spanId']
    expect(pgRow.id).toBe(eventSpanId)
    expect(pgRow.id).toEqual(expect.stringMatching(UUID_RE))
  })

  it('skips events shadow writes for spans the per-row fallback rejected', async () => {
    state.bulkInsertFails = true
    state.spanSingleInsertResults = [
      { error: null }, // span #1 succeeds
      { error: { message: 'CHECK constraint violation' } }, // span #2 rejected
    ]
    const res = await postOtlp(
      makeOtlpBody([
        { spanId: 'aaaaaaaaaaaaaaaa', name: 'ok' },
        { spanId: 'bbbbbbbbbbbbbbbb', name: 'bad' },
      ]),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { partialSuccess?: { rejectedSpans: number } }
    expect(body.partialSuccess?.rejectedSpans).toBe(1)

    // Only the surviving span flows into events.
    expect(writeSpanMock).toHaveBeenCalledTimes(1)
    const spanInput = writeSpanMock.mock.calls[0]![0] as Record<string, unknown>
    expect(spanInput['name']).toBe('ok')
  })

  it('still returns 200 when events shadow writes throw (best-effort contract)', async () => {
    writeTraceMock.mockRejectedValueOnce(new Error('CH unreachable'))
    writeSpanMock.mockRejectedValueOnce(new Error('CH unreachable'))
    const res = await postOtlp(makeOtlpBody([{ spanId: 'aaaaaaaaaaaaaaaa', name: 'root' }]))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    // No partialSuccess — the Postgres source-of-truth row landed cleanly.
    expect(body['partialSuccess']).toBeUndefined()
  })

  it('propagates error status to the trace event when any span reports error', async () => {
    const body = makeOtlpBody([{ spanId: 'aaaaaaaaaaaaaaaa', name: 'root' }])
    // Mark the span as ERROR (status.code === 2).
    body.resourceSpans[0]!.scopeSpans[0]!.spans[0]!.status = { code: 2 }
    await postOtlp(body)
    const traceInput = writeTraceMock.mock.calls[0]![0] as Record<string, unknown>
    expect(traceInput['status']).toBe('error')
    expect(traceInput['errorMessage']).toBe('One or more spans reported errors')
  })
})
