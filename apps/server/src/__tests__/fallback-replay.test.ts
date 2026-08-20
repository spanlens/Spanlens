import { beforeEach, describe, expect, test, vi } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// Tests for the fallback replay logic (P2.6).
//
// Why this matters: when the `requests` INSERT fails, the logger queues rows
// in Supabase. The replay cron is the ONLY thing that gets them back into the
// table. A regression here means rows pile up in the queue forever (or worse,
// get dropped before replay). Critical-path tests:
//
//   1. Empty queue → no INSERT attempted, returns zeros
//   2. Normal batch → one multi-row INSERT, DELETE rows from fallback
//   3. Database still down → no rows deleted, retry_count incremented
//   4. Old rows expired (>7 days) → dropped before batch even queries
//   5. Poison rows (retry_count ≥ 100) → dropped same path
//   6. fallbackQueueSize handles DB errors gracefully (returns null, not throws)
//
// The replay is idempotent through `ON CONFLICT (created_at, id) DO NOTHING`
// — the primary key enforces it, so there is no read-back and no window
// between a check and the insert.
// ─────────────────────────────────────────────────────────────────────────────

const supabaseFromMock = vi.fn()
const pgExecuteMock = vi.fn()

vi.mock('../lib/db.js', () => ({
  supabaseAdmin: {
    from: (...args: unknown[]) => supabaseFromMock(...args),
  },
}))

vi.mock('../lib/postgres.js', async (importOriginal) => {
  // Partial mock: `pgExecute` is stubbed, the parameter shim stays real so the
  // generated `{v0_id}` placeholder names are exercised as in production.
  const actual = await importOriginal<typeof import('../lib/postgres.js')>()
  return {
    ...actual,
    pgExecute: (opts: unknown) => pgExecuteMock(opts),
    pgQuery: vi.fn(async () => []),
  }
})

let replayFallbackQueue: typeof import('../lib/fallback-replay.js').replayFallbackQueue
let fallbackQueueSize: typeof import('../lib/fallback-replay.js').fallbackQueueSize
let alertOnFallbackBacklog: typeof import('../lib/fallback-replay.js').alertOnFallbackBacklog

beforeEach(async () => {
  vi.resetModules()
  supabaseFromMock.mockReset()
  pgExecuteMock.mockReset()
  // Default: the INSERT lands every row it was given.
  pgExecuteMock.mockResolvedValue(2)
  ;({ replayFallbackQueue, fallbackQueueSize, alertOnFallbackBacklog } = await import(
    '../lib/fallback-replay.js'
  ))
})

/**
 * Builder for the chain that the replay module uses on `requests_fallback`.
 * Each test sets up exactly the chain its branch needs.
 *
 * The returned recorder captures the two writes that decide whether the queue
 * drains: the batch `DELETE ... IN (ids)` on success, and the per-row
 * `UPDATE retry_count` on failure. Tests assert on those rather than trusting
 * the counters alone.
 */
function setupSupabaseChains(opts: {
  deleteResult?: { count: number } | null
  selectResult?: { data: unknown[]; error: { message: string } | null } | null
  updateResult?: { error: { message: string } | null }
  batchDeleteResult?: { error: { message: string } | null }
}) {
  const recorder = {
    deletedIds: [] as string[][],
    updates: [] as Array<{ id: string; patch: Record<string, unknown> }>,
  }
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

    // Third call onward: either bulk DELETE on success or per-row UPDATE on failure
    return {
      delete: vi.fn().mockReturnValue({
        in: vi.fn().mockImplementation(async (_col: string, ids: string[]) => {
          recorder.deletedIds.push(ids)
          return opts.batchDeleteResult ?? { error: null }
        }),
      }),
      update: vi.fn().mockImplementation((patch: Record<string, unknown>) => ({
        eq: vi.fn().mockImplementation(async (_col: string, id: string) => {
          recorder.updates.push({ id, patch })
          return opts.updateResult ?? { error: null }
        }),
      })),
    }
  })
  return recorder
}

/** Unwraps the single statement `replayFallbackQueue` handed to `pgExecute`. */
function insertedStatement(): { query: string; params: Record<string, unknown> } {
  const call = pgExecuteMock.mock.calls[0]?.[0] as
    | { query: string; params: Record<string, unknown> }
    | undefined
  if (!call) throw new Error('pgExecute was not called')
  return call
}

describe('replayFallbackQueue', () => {
  test('empty queue → no INSERT attempted, zero counters', async () => {
    setupSupabaseChains({
      deleteResult: { count: 0 },
      selectResult: { data: [], error: null },
    })

    const result = await replayFallbackQueue()
    expect(result).toEqual({ attempted: 0, replayed: 0, failed: 0, expired: 0 })
    expect(pgExecuteMock).not.toHaveBeenCalled()
  })

  test('happy path → one multi-row INSERT, rows deleted from fallback', async () => {
    const fakeRows = [
      { id: 'row1', payload: { id: 'r1', organization_id: 'o1' }, retry_count: 0 },
      { id: 'row2', payload: { id: 'r2', organization_id: 'o1' }, retry_count: 0 },
    ]
    const recorder = setupSupabaseChains({
      deleteResult: { count: 0 },
      selectResult: { data: fakeRows, error: null },
    })

    const result = await replayFallbackQueue()
    expect(result.attempted).toBe(2)
    expect(result.replayed).toBe(2)
    expect(result.failed).toBe(0)

    // One statement for the whole batch, not one per row.
    expect(pgExecuteMock).toHaveBeenCalledOnce()
    const { query, params } = insertedStatement()
    expect(query).toContain('INSERT INTO requests (')
    expect(query).toContain('ON CONFLICT (created_at, id) DO NOTHING')
    // Values are bound under generated per-row placeholder names — the
    // statement carries column names only, never anything read out of the
    // queue.
    expect(params['v0_id']).toBe('r1')
    expect(params['v1_id']).toBe('r2')
    expect(params['v0_organization_id']).toBe('o1')
    expect(params['v1_organization_id']).toBe('o1')
    expect(query).not.toContain('r1')

    // Queue row envelope ids (not payload ids) are what gets deleted.
    expect(recorder.deletedIds).toEqual([['row1', 'row2']])
  })

  test('idempotency: a payload already present is still sent — ON CONFLICT absorbs it', async () => {
    // History: while `requests` lived in ClickHouse this path did a read-back
    // and filtered known ids out client-side, because a MergeTree has no
    // unique constraint to lean on. Postgres does: `PRIMARY KEY (created_at,
    // id)`. So every payload goes into the statement and the database
    // decides — no extra round trip, and no window between the check and the
    // insert where a concurrent replay could slip a duplicate through.
    const fakeRows = [
      { id: 'row1', payload: { id: 'r1', organization_id: 'o1' }, retry_count: 0 },
      { id: 'row2', payload: { id: 'r2', organization_id: 'o1' }, retry_count: 0 },
    ]
    const recorder = setupSupabaseChains({
      deleteResult: { count: 0 },
      selectResult: { data: fakeRows, error: null },
    })
    // r1 already landed on a prior replay whose queue DELETE blipped: the
    // statement affects one row, not two.
    pgExecuteMock.mockResolvedValue(1)

    const result = await replayFallbackQueue()
    // Both queue rows are considered replayed (r1 was already there, r2 inserted).
    expect(result.replayed).toBe(2)
    expect(result.failed).toBe(0)

    const { query, params } = insertedStatement()
    expect(query).toContain('ON CONFLICT (created_at, id) DO NOTHING')
    // Nothing was filtered out client-side — both payloads are bound.
    expect(params['v0_id']).toBe('r1')
    expect(params['v1_id']).toBe('r2')
    // And exactly one statement was issued — no read-back round trip.
    expect(pgExecuteMock).toHaveBeenCalledOnce()
    // The whole batch leaves the queue, including the row the conflict skipped.
    expect(recorder.deletedIds).toEqual([['row1', 'row2']])
  })

  test('idempotency: a fully duplicate batch is a no-op INSERT, queue still drained', async () => {
    // `ON CONFLICT ... DO NOTHING` reports 0 rows affected when every row in
    // the batch already exists. That is success, not failure: the data is in
    // the table, so the queue rows must go.
    const fakeRows = [
      { id: 'row1', payload: { id: 'r1' }, retry_count: 0 },
      { id: 'row2', payload: { id: 'r2' }, retry_count: 0 },
    ]
    const recorder = setupSupabaseChains({
      deleteResult: { count: 0 },
      selectResult: { data: fakeRows, error: null },
    })
    pgExecuteMock.mockResolvedValue(0)

    const result = await replayFallbackQueue()
    expect(result.replayed).toBe(2)
    expect(result.failed).toBe(0)
    expect(insertedStatement().query).toContain('ON CONFLICT (created_at, id) DO NOTHING')
    expect(recorder.deletedIds).toEqual([['row1', 'row2']])
  })

  test('requests INSERT fails → no rows deleted, retry_count incremented per row', async () => {
    const fakeRows = [
      { id: 'row1', payload: { id: 'r1' }, retry_count: 0 },
      { id: 'row2', payload: { id: 'r2' }, retry_count: 3 },
    ]
    const recorder = setupSupabaseChains({
      deleteResult: { count: 0 },
      selectResult: { data: fakeRows, error: null },
    })
    pgExecuteMock.mockRejectedValue(new Error('pooler unreachable'))

    const result = await replayFallbackQueue()
    expect(result.attempted).toBe(2)
    expect(result.replayed).toBe(0)
    expect(result.failed).toBe(2)
    expect(result.error).toMatch(/requests insert failed: pooler unreachable/)

    // Rows stay queued, each with its own retry_count bumped from its own
    // starting value — a shared counter would reset row2's 3 attempts.
    expect(recorder.deletedIds).toEqual([])
    expect(recorder.updates.map((u) => [u.id, u.patch['retry_count']])).toEqual([
      ['row1', 1],
      ['row2', 4],
    ])
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
    expect(pgExecuteMock).not.toHaveBeenCalled()
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

describe('alertOnFallbackBacklog', () => {
  // Mocks the requests_fallback size query plus the internal_alerts dedup
  // SELECT + INSERT.
  function setupBacklogChains(opts: {
    queueCount: number
    existingAlert?: { id: string } | null
    insertMock?: ReturnType<typeof vi.fn>
  }) {
    const insertMock = opts.insertMock ?? vi.fn().mockResolvedValue({ error: null })
    supabaseFromMock.mockImplementation((table: string) => {
      if (table === 'internal_alerts') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: opts.existingAlert ?? null, error: null }),
          insert: insertMock,
        }
      }
      // requests_fallback size query
      return { select: vi.fn().mockResolvedValue({ count: opts.queueCount, error: null }) }
    })
    return insertMock
  }

  test('under threshold → no alert', async () => {
    setupBacklogChains({ queueCount: 5 })
    const r = await alertOnFallbackBacklog(1000)
    expect(r.alerted).toBe(false)
    expect(r.requestsQueue).toBe(5)
  })

  test('over threshold + no open alert → inserts a fallback_queue_high alert', async () => {
    const insertMock = setupBacklogChains({ queueCount: 5000 })
    const r = await alertOnFallbackBacklog(1000)
    expect(r.alerted).toBe(true)
    expect(insertMock).toHaveBeenCalledOnce()
    const arg = insertMock.mock.calls[0]?.[0] as { kind: string; severity: string }
    expect(arg.kind).toBe('fallback_queue_high')
    expect(arg.severity).toBe('error')
  })

  test('over threshold but alert already open → deduped, no insert', async () => {
    const insertMock = setupBacklogChains({ queueCount: 5000, existingAlert: { id: 'open-1' } })
    const r = await alertOnFallbackBacklog(1000)
    expect(r.alerted).toBe(false)
    expect(insertMock).not.toHaveBeenCalled()
  })
})
