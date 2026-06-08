import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock supabaseAdmin before importing the SUT so the import-time
// closure binds to our stub. The mock returns a stack of chainable
// builders so each call to `supabaseAdmin.from('spans')` consumes
// one queued response. Tests script the response sequence per case.
type Builder = {
  select: ReturnType<typeof vi.fn>
  is: ReturnType<typeof vi.fn>
  not: ReturnType<typeof vi.fn>
  gt: ReturnType<typeof vi.fn>
  order: ReturnType<typeof vi.fn>
  limit: ReturnType<typeof vi.fn>
  eq: ReturnType<typeof vi.fn>
  maybeSingle: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
  then: (resolve: (value: unknown) => void) => void
}

type Response = { data?: unknown; error?: { message: string } | null }

let responseQueue: Response[] = []
const updateCalls: { id: string; parent_span_id: string }[] = []

function makeBuilder(): Builder {
  const builder = {} as Builder
  builder.select = vi.fn(() => builder)
  builder.is = vi.fn(() => builder)
  builder.not = vi.fn(() => builder)
  builder.gt = vi.fn(() => builder)
  builder.order = vi.fn(() => builder)
  builder.limit = vi.fn(() => {
    const next = responseQueue.shift() ?? { data: [], error: null }
    return Promise.resolve(next) as unknown as Builder
  })
  builder.eq = vi.fn(() => builder)
  builder.maybeSingle = vi.fn(() => {
    const next = responseQueue.shift() ?? { data: null, error: null }
    return Promise.resolve(next)
  })
  builder.update = vi.fn((payload: { parent_span_id: string }) => {
    return {
      eq: (_col: string, id: string) => {
        updateCalls.push({ id, parent_span_id: payload.parent_span_id })
        const next = responseQueue.shift() ?? { error: null }
        return Promise.resolve(next)
      },
    } as unknown as Builder
  })
  return builder
}

vi.mock('../../../db.js', () => ({
  supabaseAdmin: {
    from: vi.fn(() => makeBuilder()),
  },
}))

import { orphanSpanLink } from './orphan-span-link.js'

describe('orphan-span-link background migration', () => {
  beforeEach(() => {
    responseQueue = []
    updateCalls.length = 0
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns done:true when no orphan rows remain', async () => {
    responseQueue.push({ data: [], error: null })
    const result = await orphanSpanLink.runChunk({})
    expect(result).toEqual({ done: true })
  })

  it('links an orphan to its parent when both share a trace', async () => {
    // 1st .limit() — orphan SELECT
    responseQueue.push({
      data: [
        {
          id: 'child-1',
          trace_id: 'trace-A',
          external_parent_span_id: 'otel-parent-A',
        },
      ],
      error: null,
    })
    // 2nd response — maybeSingle() parent lookup
    responseQueue.push({ data: { id: 'parent-uuid-1' }, error: null })
    // 3rd response — update().eq()
    responseQueue.push({ error: null })

    const result = await orphanSpanLink.runChunk({})
    expect(result.done).toBe(false)
    if (result.done === false) {
      expect((result.state as { matched: number }).matched).toBe(1)
      expect((result.state as { lastId: string }).lastId).toBe('child-1')
    }
    expect(updateCalls).toEqual([
      { id: 'child-1', parent_span_id: 'parent-uuid-1' },
    ])
  })

  it('leaves orphans whose parent has not arrived yet — does NOT throw', async () => {
    responseQueue.push({
      data: [
        {
          id: 'child-2',
          trace_id: 'trace-B',
          external_parent_span_id: 'otel-missing-B',
        },
      ],
      error: null,
    })
    // maybeSingle() returns null — parent not ingested yet
    responseQueue.push({ data: null, error: null })

    const result = await orphanSpanLink.runChunk({})
    expect(result.done).toBe(false)
    if (result.done === false) {
      expect((result.state as { matched: number }).matched).toBe(0)
      expect((result.state as { scanned: number }).scanned).toBe(1)
    }
    expect(updateCalls).toEqual([])
  })

  it('advances cursor.lastId so the next chunk does not rescan the same row', async () => {
    responseQueue.push({
      data: [
        { id: 'a', trace_id: 't', external_parent_span_id: 'x' },
        { id: 'b', trace_id: 't', external_parent_span_id: 'y' },
      ],
      error: null,
    })
    responseQueue.push({ data: null, error: null }) // a's parent miss
    responseQueue.push({ data: null, error: null }) // b's parent miss

    const result = await orphanSpanLink.runChunk({ lastId: '0' })
    expect(result.done).toBe(false)
    if (result.done === false) {
      expect((result.state as { lastId: string }).lastId).toBe('b')
    }
  })

  it('throws when the orphan SELECT errors so the runner can mark failed', async () => {
    responseQueue.push({ data: null, error: { message: 'network down' } })
    await expect(orphanSpanLink.runChunk({})).rejects.toThrow(/network down/)
  })
})
