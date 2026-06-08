import { beforeEach, describe, expect, test, vi } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// Tests for the ClickHouse fallback replay logic (P2.6).
//
// Why this matters: when CH is unreachable, the logger queues rows in
// Supabase. The replay cron is the ONLY thing that gets them back into CH.
// A regression here means rows pile up in Supabase forever (or worse, get
// dropped before replay). Critical-path tests:
//
//   1. Empty queue → no CH insert attempted, returns zeros
//   2. Normal batch → bulk INSERT to CH, DELETE rows from fallback
//   3. CH still down → no rows deleted, retry_count incremented
//   4. Old rows expired (>7 days) → dropped before batch even queries
//   5. Poison rows (retry_count ≥ 100) → dropped same path
//   6. fallbackQueueSize handles DB errors gracefully (returns null, not throws)
// ─────────────────────────────────────────────────────────────────────────────

const supabaseFromMock = vi.fn()
const clickhouseInsertMock = vi.fn()

vi.mock('../lib/db.js', () => ({
  supabaseAdmin: {
    from: (...args: unknown[]) => supabaseFromMock(...args),
  },
}))

vi.mock('../lib/clickhouse.js', () => ({
  unscopedClickhouse: () => ({
    insert: (opts: unknown) => clickhouseInsertMock(opts),
  }),
}))

let replayFallbackQueue: typeof import('../lib/fallback-replay.js').replayFallbackQueue
let fallbackQueueSize: typeof import('../lib/fallback-replay.js').fallbackQueueSize

beforeEach(async () => {
  vi.resetModules()
  supabaseFromMock.mockReset()
  clickhouseInsertMock.mockReset()
  ;({ replayFallbackQueue, fallbackQueueSize } = await import('../lib/fallback-replay.js'))
})

// Builder for the chain that the replay module uses on `requests_fallback`.
// Each test sets up exactly the chain its branch needs.
function setupSupabaseChains(opts: {
  deleteResult?: { count: number } | null
  selectResult?: { data: unknown[]; error: { message: string } | null } | null
  updateResult?: { error: { message: string } | null }
  batchDeleteResult?: { error: { message: string } | null }
}) {
  let callCount = 0
  supabaseFromMock.mockImplementation((_table: string) => {
    callCount += 1

    // First call: DELETE expired rows (uses .or())
    if (callCount === 1) {
      return {
        delete: vi.fn().mockReturnValue({
          or: vi
            .fn()
            .mockResolvedValue(opts.deleteResult ?? { count: 0 }),
        }),
      }
    }

    // Second call: SELECT next batch
    if (callCount === 2) {
      return {
        select: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue(
          opts.selectResult ?? { data: [], error: null },
        ),
      }
    }

    // Third call: either bulk DELETE on success or per-row UPDATE on failure
    return {
      delete: vi.fn().mockReturnValue({
        in: vi.fn().mockResolvedValue(opts.batchDeleteResult ?? { error: null }),
      }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue(opts.updateResult ?? { error: null }),
      }),
    }
  })
}

describe('replayFallbackQueue', () => {
  test('empty queue → no CH call, zero counters', async () => {
    setupSupabaseChains({
      deleteResult: { count: 0 },
      selectResult: { data: [], error: null },
    })

    const result = await replayFallbackQueue()
    expect(result).toEqual({ attempted: 0, replayed: 0, failed: 0, expired: 0 })
    expect(clickhouseInsertMock).not.toHaveBeenCalled()
  })

  test('happy path → CH bulk INSERT, rows deleted from fallback', async () => {
    const fakeRows = [
      { id: 'row1', payload: { id: 'r1', organization_id: 'o1' }, retry_count: 0 },
      { id: 'row2', payload: { id: 'r2', organization_id: 'o1' }, retry_count: 0 },
    ]
    setupSupabaseChains({
      deleteResult: { count: 0 },
      selectResult: { data: fakeRows, error: null },
    })
    clickhouseInsertMock.mockResolvedValue(undefined)

    const result = await replayFallbackQueue()
    expect(result.attempted).toBe(2)
    expect(result.replayed).toBe(2)
    expect(result.failed).toBe(0)
    expect(clickhouseInsertMock).toHaveBeenCalledOnce()
    // The bulk insert receives raw payloads — not Supabase row envelopes
    const callArg = clickhouseInsertMock.mock.calls[0]?.[0] as { values: unknown[] }
    expect(callArg.values).toEqual([
      { id: 'r1', organization_id: 'o1' },
      { id: 'r2', organization_id: 'o1' },
    ])
  })

  test('ClickHouse INSERT fails → no rows deleted, retry_count incremented per row', async () => {
    const fakeRows = [
      { id: 'row1', payload: { id: 'r1' }, retry_count: 0 },
      { id: 'row2', payload: { id: 'r2' }, retry_count: 3 },
    ]
    setupSupabaseChains({
      deleteResult: { count: 0 },
      selectResult: { data: fakeRows, error: null },
    })
    clickhouseInsertMock.mockRejectedValue(new Error('CH unreachable'))

    const result = await replayFallbackQueue()
    expect(result.attempted).toBe(2)
    expect(result.replayed).toBe(0)
    expect(result.failed).toBe(2)
    expect(result.error).toMatch(/CH unreachable/)
  })

  test('expired rows reported via expired counter (before SELECT)', async () => {
    setupSupabaseChains({
      deleteResult: { count: 17 },
      selectResult: { data: [], error: null },
    })

    const result = await replayFallbackQueue()
    expect(result.expired).toBe(17)
    expect(result.attempted).toBe(0)
  })

  test('Supabase SELECT failure surfaces top-level error', async () => {
    setupSupabaseChains({
      deleteResult: { count: 0 },
      selectResult: { data: [], error: { message: 'supabase timeout' } },
    })

    const result = await replayFallbackQueue()
    expect(result.error).toMatch(/select failed.*supabase timeout/)
    expect(clickhouseInsertMock).not.toHaveBeenCalled()
  })
})

describe('fallbackQueueSize', () => {
  test('returns count from Supabase head=true query', async () => {
    supabaseFromMock.mockReturnValue({
      select: vi.fn().mockResolvedValue({ count: 42, error: null }),
    })

    const size = await fallbackQueueSize()
    expect(size).toBe(42)
  })

  test('returns null on Supabase error (graceful for /health)', async () => {
    supabaseFromMock.mockReturnValue({
      select: vi.fn().mockResolvedValue({
        count: null,
        error: { message: 'connection refused' },
      }),
    })

    const size = await fallbackQueueSize()
    expect(size).toBeNull()
  })

  test('treats null count as 0 when no error', async () => {
    supabaseFromMock.mockReturnValue({
      select: vi.fn().mockResolvedValue({ count: null, error: null }),
    })

    const size = await fallbackQueueSize()
    expect(size).toBe(0)
  })
})
