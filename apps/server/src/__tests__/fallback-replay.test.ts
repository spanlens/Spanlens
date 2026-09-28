import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

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
//   3. Database still down → no rows deleted, retry budget untouched
//   4. Old rows expired (>7 days) → dropped before batch even queries
//   5. Poison rows → isolated row by row so they cannot hold the queue
//      hostage, and only THEY spend retries (including SQLSTATE 54000, an
//      end-user id too long to index, and codes the replay has no rule for)
//   6. request.created for replayed rows → sent a few at a time, after the
//      queue bookkeeping, within a time budget; the rest recorded undelivered
//   7. fallbackQueueSize handles DB errors gracefully (returns null, not throws)
//
// The replay is idempotent through `ON CONFLICT (created_at, id) DO NOTHING`
// — the primary key enforces it, so there is no read-back and no window
// between a check and the insert. `RETURNING id` reports which payloads the
// statement actually inserted, which is what request.created is fired for.
//
// Supabase mocks follow the real supabase-js contract: a failed write
// RESOLVES with `{ error }`, it does not reject.
// ─────────────────────────────────────────────────────────────────────────────

const supabaseFromMock = vi.fn()
const pgQueryMock = vi.fn()
const recordOrgActivityMock = vi.fn()
const emitRequestCreatedMock = vi.fn()
const deferRequestCreatedMock = vi.fn()

vi.mock('../lib/db.js', () => ({
  supabaseAdmin: {
    from: (...args: unknown[]) => supabaseFromMock(...args),
  },
}))

vi.mock('../lib/postgres.js', async (importOriginal) => {
  // Partial mock: the query entry points are stubbed, the parameter shim
  // stays real so the generated `{v0_id}` placeholder names are exercised as
  // in production.
  const actual = await importOriginal<typeof import('../lib/postgres.js')>()
  return {
    ...actual,
    pgQuery: (opts: unknown) => pgQueryMock(opts),
    pgExecute: vi.fn(async () => {
      throw new Error('replay must use pgQuery (RETURNING id), not pgExecute')
    }),
  }
})

vi.mock('../lib/org-activity.js', () => ({
  recordOrgActivity: (...args: unknown[]) => recordOrgActivityMock(...args),
}))

vi.mock('../lib/logger.js', () => ({
  emitRequestCreated: (...args: unknown[]) => emitRequestCreatedMock(...args),
  deferRequestCreated: (...args: unknown[]) => deferRequestCreatedMock(...args),
}))

let replayFallbackQueue: typeof import('../lib/fallback-replay.js').replayFallbackQueue
let fallbackQueueSize: typeof import('../lib/fallback-replay.js').fallbackQueueSize
let alertOnFallbackBacklog: typeof import('../lib/fallback-replay.js').alertOnFallbackBacklog

beforeEach(async () => {
  vi.resetModules()
  supabaseFromMock.mockReset()
  pgQueryMock.mockReset()
  recordOrgActivityMock.mockReset()
  recordOrgActivityMock.mockResolvedValue(undefined)
  emitRequestCreatedMock.mockReset()
  emitRequestCreatedMock.mockResolvedValue(undefined)
  deferRequestCreatedMock.mockReset()
  deferRequestCreatedMock.mockResolvedValue(undefined)
  // Default: the INSERT lands every payload it was given.
  pgQueryMock.mockImplementation(async (opts: { params: Record<string, unknown> }) =>
    boundIds(opts.params).map((id) => ({ id })),
  )
  ;({ replayFallbackQueue, fallbackQueueSize, alertOnFallbackBacklog } = await import(
    '../lib/fallback-replay.js'
  ))
})

afterEach(() => vi.restoreAllMocks())

/** Payload ids bound into one replay statement, in row order. */
function boundIds(params: Record<string, unknown>): string[] {
  return Object.keys(params)
    .map((key) => /^v(\d+)_id$/.exec(key))
    .filter((m): m is RegExpExecArray => m !== null)
    .sort((a, b) => Number(a[1]) - Number(b[1]))
    .map((m) => String(params[m[0]]))
}

/** A node-postgres server error: SQLSTATE travels on `code`. */
function pgError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code })
}

type ConsoleSpy = { mock: { calls: unknown[][] } }

function loggedKinds(spy: ConsoleSpy): string[] {
  return spy.mock.calls
    .map((args) => /"kind":"([a-z_]+)"/.exec(String(args[0]))?.[1] ?? '')
    .filter((kind) => kind !== '')
}

/**
 * Builder for the chain that the replay module uses on `requests_fallback`.
 * Each test sets up exactly the chain its branch needs.
 *
 * The returned recorder captures the writes that decide whether the queue
 * drains: the batch `DELETE ... IN (ids)` on success, the per-row `UPDATE
 * retry_count` for a row the database rejects, and the bulk `UPDATE
 * last_error` for a batch deferred because the database itself is failing.
 */
function setupSupabaseChains(opts: {
  deleteResult?: { count: number | null; error?: { message: string } | null }
  selectResult?: { data: unknown[]; error: { message: string } | null } | null
  updateResult?: { error: { message: string } | null }
  batchDeleteResult?: { error: { message: string } | null }
}) {
  const recorder = {
    deletedIds: [] as string[][],
    updates: [] as Array<{ id: string; patch: Record<string, unknown> }>,
    bulkUpdates: [] as Array<{ ids: string[]; patch: Record<string, unknown> }>,
    orderBy: [] as string[],
  }
  let callCount = 0
  supabaseFromMock.mockImplementation((_table: string) => {
    callCount += 1

    // First call: DELETE expired rows (uses .or())
    if (callCount === 1) {
      return {
        delete: vi.fn().mockReturnValue({
          or: vi.fn().mockResolvedValue({ error: null, ...(opts.deleteResult ?? { count: 0 }) }),
        }),
      }
    }

    // Second call: SELECT next batch
    if (callCount === 2) {
      const chain = {
        select: vi.fn(() => chain),
        order: vi.fn((col: string) => {
          recorder.orderBy.push(col)
          return chain
        }),
        limit: vi.fn().mockResolvedValue(opts.selectResult ?? { data: [], error: null }),
      }
      return chain
    }

    // Third call onward: bulk DELETE on success, per-row / bulk UPDATE on failure
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
        in: vi.fn().mockImplementation(async (_col: string, ids: string[]) => {
          recorder.bulkUpdates.push({ ids, patch })
          return opts.updateResult ?? { error: null }
        }),
      })),
    }
  })
  return recorder
}

/** Unwraps the statement `replayFallbackQueue` sent as call `index`. */
function insertedStatement(index = 0): { query: string; params: Record<string, unknown> } {
  const call = pgQueryMock.mock.calls[index]?.[0] as
    | { query: string; params: Record<string, unknown> }
    | undefined
  if (!call) throw new Error(`pgQuery call ${index} was not made`)
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
    expect(pgQueryMock).not.toHaveBeenCalled()
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
    expect(result.error).toBeUndefined()

    // One statement for the whole batch, not one per row.
    expect(pgQueryMock).toHaveBeenCalledOnce()
    const { query, params } = insertedStatement()
    expect(query).toContain('INSERT INTO requests (')
    expect(query).toContain('ON CONFLICT (created_at, id) DO NOTHING')
    expect(query).toContain('RETURNING id')
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
    // statement inserts (and returns) only r2.
    pgQueryMock.mockResolvedValue([{ id: 'r2' }])

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
    expect(pgQueryMock).toHaveBeenCalledOnce()
    // The whole batch leaves the queue, including the row the conflict skipped.
    expect(recorder.deletedIds).toEqual([['row1', 'row2']])
  })

  test('idempotency: a fully duplicate batch is a no-op INSERT, queue still drained', async () => {
    // `ON CONFLICT ... DO NOTHING` returns no rows when every row in the batch
    // already exists. That is success, not failure: the data is in the
    // table, so the queue rows must go.
    const fakeRows = [
      { id: 'row1', payload: { id: 'r1' }, retry_count: 0 },
      { id: 'row2', payload: { id: 'r2' }, retry_count: 0 },
    ]
    const recorder = setupSupabaseChains({
      deleteResult: { count: 0 },
      selectResult: { data: fakeRows, error: null },
    })
    pgQueryMock.mockResolvedValue([])

    const result = await replayFallbackQueue()
    expect(result.replayed).toBe(2)
    expect(result.failed).toBe(0)
    expect(insertedStatement().query).toContain('ON CONFLICT (created_at, id) DO NOTHING')
    expect(recorder.deletedIds).toEqual([['row1', 'row2']])
  })

  test('database unreachable → no rows deleted, retry budget NOT spent, error noted on the rows', async () => {
    // A failure with no SQLSTATE (connection refused, pool timeout) is about
    // the database, not the rows. Spending retries on it let a long outage
    // (or three schedulers firing at once) burn the 100-retry budget of
    // perfectly good rows, which were then deleted.
    const fakeRows = [
      { id: 'row1', payload: { id: 'r1' }, retry_count: 0 },
      { id: 'row2', payload: { id: 'r2' }, retry_count: 3 },
    ]
    const recorder = setupSupabaseChains({
      deleteResult: { count: 0 },
      selectResult: { data: fakeRows, error: null },
    })
    pgQueryMock.mockRejectedValue(
      Object.assign(new Error('pooler unreachable'), { code: 'ECONNREFUSED' }),
    )

    const result = await replayFallbackQueue()
    expect(result.attempted).toBe(2)
    expect(result.replayed).toBe(0)
    expect(result.failed).toBe(2)
    expect(result.error).toMatch(/requests insert failed: pooler unreachable/)

    // No row-by-row isolation while the database itself is down: that would
    // be 50 more doomed round trips inside one cron invocation.
    expect(pgQueryMock).toHaveBeenCalledOnce()
    expect(recorder.deletedIds).toEqual([])
    expect(recorder.updates).toEqual([])
    expect(recorder.bulkUpdates).toHaveLength(1)
    expect(recorder.bulkUpdates[0]!.ids).toEqual(['row1', 'row2'])
    expect(recorder.bulkUpdates[0]!.patch['retry_count']).toBeUndefined()
    expect(String(recorder.bulkUpdates[0]!.patch['last_error'])).toContain('pooler unreachable')
  })

  test('schema behind the code (42703) is deferred, not treated as poison', async () => {
    // gotcha #21/#23: the queue exists precisely so rows survive a deploy
    // that reached production before its migration. That failure hits every
    // row alike and clears when the migration lands.
    const fakeRows = [
      { id: 'row1', payload: { id: 'r1' }, retry_count: 0 },
      { id: 'row2', payload: { id: 'r2' }, retry_count: 0 },
    ]
    const recorder = setupSupabaseChains({
      deleteResult: { count: 0 },
      selectResult: { data: fakeRows, error: null },
    })
    pgQueryMock.mockRejectedValue(pgError('42703', 'column "new_col" of relation "requests" does not exist'))

    const result = await replayFallbackQueue()
    expect(result.failed).toBe(2)
    expect(pgQueryMock).toHaveBeenCalledOnce()
    expect(recorder.updates).toEqual([])
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
    expect(pgQueryMock).not.toHaveBeenCalled()
  })

  test('rows that already spent retries sort behind fresh ones', async () => {
    const recorder = setupSupabaseChains({
      deleteResult: { count: 0 },
      selectResult: { data: [], error: null },
    })

    await replayFallbackQueue()
    expect(recorder.orderBy).toEqual(['retry_count', 'created_at'])
  })
})

describe('replayFallbackQueue — poison rows (C8.3)', () => {
  test('one row the database rejects is isolated: the rest of the batch lands, only it spends a retry', async () => {
    const fakeRows = [
      { id: 'q-poison', payload: { id: 'p', organization_id: 'org_deleted' }, retry_count: 4 },
      { id: 'q-a', payload: { id: 'a', organization_id: 'o1' }, retry_count: 0 },
      { id: 'q-b', payload: { id: 'b', organization_id: 'o2' }, retry_count: 0 },
    ]
    const recorder = setupSupabaseChains({
      deleteResult: { count: 0 },
      selectResult: { data: fakeRows, error: null },
    })
    const fkViolation = pgError(
      '23503',
      'insert or update on table "requests" violates foreign key constraint "requests_organization_id_fkey"',
    )
    pgQueryMock.mockImplementation(async (opts: { params: Record<string, unknown> }) => {
      const ids = boundIds(opts.params)
      if (ids.includes('p')) throw fkViolation
      return ids.map((id) => ({ id }))
    })

    const result = await replayFallbackQueue()

    expect(result.attempted).toBe(3)
    expect(result.replayed).toBe(2)
    expect(result.failed).toBe(1)
    expect(result.error).toMatch(/violates foreign key constraint/)
    // One batch attempt, then one statement per row.
    expect(pgQueryMock).toHaveBeenCalledTimes(4)
    expect(recorder.deletedIds).toEqual([['q-a', 'q-b']])
    expect(recorder.updates.map((u) => [u.id, u.patch['retry_count']])).toEqual([['q-poison', 5]])
    expect(String(recorder.updates[0]!.patch['last_error'])).toContain('foreign key')
  })

  test('the database going away mid-isolation defers the remaining rows without spending retries', async () => {
    const fakeRows = [
      { id: 'q-a', payload: { id: 'a' }, retry_count: 0 },
      { id: 'q-poison', payload: { id: 'p' }, retry_count: 0 },
      { id: 'q-b', payload: { id: 'b' }, retry_count: 0 },
      { id: 'q-c', payload: { id: 'c' }, retry_count: 0 },
    ]
    const recorder = setupSupabaseChains({
      deleteResult: { count: 0 },
      selectResult: { data: fakeRows, error: null },
    })
    let singleRowCalls = 0
    pgQueryMock.mockImplementation(async (opts: { params: Record<string, unknown> }) => {
      const ids = boundIds(opts.params)
      if (ids.length > 1) throw pgError('23502', 'null value in column "project_id" violates not-null constraint')
      singleRowCalls += 1
      if (ids[0] === 'p') throw pgError('23502', 'null value in column "project_id" violates not-null constraint')
      if (singleRowCalls >= 3) throw Object.assign(new Error('Connection terminated unexpectedly'), {})
      return ids.map((id) => ({ id }))
    })

    const result = await replayFallbackQueue()

    expect(result.replayed).toBe(1) // q-a
    expect(result.failed).toBe(3) // poison + b (connection dropped) + c (never tried)
    expect(recorder.deletedIds).toEqual([['q-a']])
    expect(recorder.updates.map((u) => [u.id, u.patch['retry_count']])).toEqual([['q-poison', 1]])
    expect(recorder.bulkUpdates.map((u) => u.ids)).toEqual([['q-b', 'q-c']])
    expect(recorder.bulkUpdates[0]!.patch['retry_count']).toBeUndefined()
  })

  test('a single-row batch the database rejects is not re-sent just to be isolated', async () => {
    const fakeRows = [{ id: 'q-poison', payload: { id: 'p' }, retry_count: 7 }]
    const recorder = setupSupabaseChains({
      deleteResult: { count: 0 },
      selectResult: { data: fakeRows, error: null },
    })
    pgQueryMock.mockRejectedValue(pgError('22P02', 'invalid input syntax for type integer'))

    const result = await replayFallbackQueue()

    expect(result.failed).toBe(1)
    expect(pgQueryMock).toHaveBeenCalledOnce()
    expect(recorder.updates.map((u) => [u.id, u.patch['retry_count']])).toEqual([['q-poison', 8]])
  })

  test('stateful queue: a poison row at the head no longer blocks, and no good row is ever expired', async () => {
    // Reproduces the audit probe: 1 poison + 59 good rows. Before the fix
    // every run re-selected the same head batch, failed all 50, and on run
    // 101 the retry expiry deleted 49 good rows along with the poison one.
    interface FakeQueueRow {
      id: string
      payload: Record<string, unknown>
      retry_count: number
      created_at: string
    }
    const base = Date.now() - 60_000
    const queue: FakeQueueRow[] = [
      {
        id: 'q-poison',
        payload: { id: 'poison', organization_id: 'org_deleted' },
        retry_count: 0,
        created_at: new Date(base).toISOString(),
      },
      ...Array.from({ length: 59 }, (_, i) => ({
        id: `q-${i}`,
        payload: { id: `good-${i}`, organization_id: 'org_live' },
        retry_count: 0,
        created_at: new Date(base + (i + 1) * 10).toISOString(),
      })),
    ]
    const inRequests = new Set<string>()
    let expiredGood = 0

    const remove = (ids: ReadonlySet<string>): void => {
      for (let i = queue.length - 1; i >= 0; i--) {
        if (ids.has(queue[i]!.id)) queue.splice(i, 1)
      }
    }

    supabaseFromMock.mockImplementation(() => ({
      delete: () => ({
        or: async (filter: string) => {
          const m = /^created_at\.lt\.([^,]+),retry_count\.gte\.(\d+)$/.exec(filter)
          if (!m) throw new Error(`unexpected expiry filter: ${filter}`)
          const doomed = queue.filter((r) => r.created_at < m[1]! || r.retry_count >= Number(m[2]))
          expiredGood += doomed.filter((r) => r.id !== 'q-poison').length
          remove(new Set(doomed.map((r) => r.id)))
          return { count: doomed.length, error: null }
        },
        in: async (_col: string, ids: string[]) => {
          remove(new Set(ids))
          return { error: null }
        },
      }),
      select: () => {
        const order: Array<[string, boolean]> = []
        const chain = {
          order: (col: string, o: { ascending: boolean }) => {
            order.push([col, o.ascending])
            return chain
          },
          limit: async (n: number) => {
            const sorted = [...queue].sort((a, b) => {
              for (const [col, asc] of order) {
                const av = a[col as keyof FakeQueueRow] as number | string
                const bv = b[col as keyof FakeQueueRow] as number | string
                if (av !== bv) return (av < bv ? -1 : 1) * (asc ? 1 : -1)
              }
              return 0
            })
            return { data: sorted.slice(0, n).map((r) => ({ ...r })), error: null }
          },
        }
        return chain
      },
      update: (patch: Record<string, unknown>) => ({
        eq: async (_col: string, id: string) => {
          const row = queue.find((r) => r.id === id)
          if (row && typeof patch['retry_count'] === 'number') row.retry_count = patch['retry_count']
          return { error: null }
        },
        in: async () => ({ error: null }),
      }),
    }))

    pgQueryMock.mockImplementation(async (opts: { params: Record<string, unknown> }) => {
      const ids = boundIds(opts.params)
      if (ids.includes('poison')) {
        throw pgError('23503', 'violates foreign key constraint "requests_organization_id_fkey"')
      }
      const fresh = ids.filter((id) => !inRequests.has(id))
      for (const id of fresh) inRequests.add(id)
      return fresh.map((id) => ({ id }))
    })

    const first = await replayFallbackQueue()
    expect(first.replayed).toBe(49)
    const second = await replayFallbackQueue()
    expect(second.replayed).toBe(10)
    // Every good row is in `requests` after two runs.
    expect(inRequests.size).toBe(59)

    // The poison row keeps failing on its own until its retry budget runs
    // out, and then only IT is expired.
    for (let run = 0; run < 110 && queue.length > 0; run++) {
      await replayFallbackQueue()
    }
    expect(queue).toEqual([])
    expect(expiredGood).toBe(0)
  })
})

describe('replayFallbackQueue — which failures isolate a row', () => {
  const threeRows = [
    { id: 'q-poison', payload: { id: 'p', organization_id: 'o1' }, retry_count: 0 },
    { id: 'q-a', payload: { id: 'a', organization_id: 'o1' }, retry_count: 0 },
    { id: 'q-b', payload: { id: 'b', organization_id: 'o2' }, retry_count: 0 },
  ]

  /** The INSERT fails with `err` whenever the poison payload is in it. */
  function failWhenPoisonBound(err: Error): void {
    pgQueryMock.mockImplementation(async (opts: { params: Record<string, unknown> }) => {
      const ids = boundIds(opts.params)
      if (ids.includes('p')) throw err
      return ids.map((id) => ({ id }))
    })
  }

  test('an end-user id too long for its index (54000) is a row problem: isolated, the rest lands', async () => {
    // Reproduced against local Postgres: a user_id past ~2.7KB fails the
    // partial btree on (organization_id, user_id, created_at). Deferring it
    // as a database failure left retry_count at 0, so the same row headed
    // every batch and held the whole queue until the 7-day expiry.
    const recorder = setupSupabaseChains({
      deleteResult: { count: 0 },
      selectResult: { data: threeRows, error: null },
    })
    failWhenPoisonBound(
      pgError(
        '54000',
        'index row size 6440 exceeds btree version 4 maximum 2704 for index "requests_2026_09_organization_id_user_id_created_at_idx"',
      ),
    )

    const result = await replayFallbackQueue()

    expect(result.replayed).toBe(2)
    expect(result.failed).toBe(1)
    expect(recorder.deletedIds).toEqual([['q-a', 'q-b']])
    expect(recorder.updates.map((u) => [u.id, u.patch['retry_count']])).toEqual([['q-poison', 1]])
    expect(recorder.bulkUpdates).toEqual([])
  })

  test('a single-row batch rejected with 54000 spends its retry without a second attempt', async () => {
    const recorder = setupSupabaseChains({
      deleteResult: { count: 0 },
      selectResult: { data: [threeRows[0]!], error: null },
    })
    pgQueryMock.mockRejectedValue(pgError('54000', 'index row size 6440 exceeds btree version 4 maximum 2704'))

    await replayFallbackQueue()

    expect(pgQueryMock).toHaveBeenCalledOnce()
    expect(recorder.updates.map((u) => [u.id, u.patch['retry_count']])).toEqual([['q-poison', 1]])
  })

  test('a SQLSTATE the replay has no rule for is isolated; the row failing while others land spends a retry', async () => {
    // P0001 is what a RAISE in a trigger would produce. Nothing the replay
    // knows about, but other rows landing in the same run proves the database
    // is accepting inserts, so the failure belongs to that row.
    const recorder = setupSupabaseChains({
      deleteResult: { count: 0 },
      selectResult: { data: threeRows, error: null },
    })
    failWhenPoisonBound(pgError('P0001', 'row rejected by trigger'))

    const result = await replayFallbackQueue()

    expect(result.replayed).toBe(2)
    expect(recorder.deletedIds).toEqual([['q-a', 'q-b']])
    expect(recorder.updates.map((u) => [u.id, u.patch['retry_count']])).toEqual([['q-poison', 1]])
  })

  test('a SQLSTATE the replay has no rule for that every row hits is not charged to the rows', async () => {
    // With nothing landing there is no evidence the rows are at fault, so the
    // failure is treated like the database's own: queued as is, no retry spent.
    const recorder = setupSupabaseChains({
      deleteResult: { count: 0 },
      selectResult: { data: threeRows, error: null },
    })
    pgQueryMock.mockRejectedValue(pgError('P0001', 'inserts disabled by trigger'))

    const result = await replayFallbackQueue()

    expect(result.replayed).toBe(0)
    expect(result.failed).toBe(3)
    expect(result.error).toMatch(/inserts disabled by trigger/)
    expect(recorder.deletedIds).toEqual([])
    expect(recorder.updates).toEqual([])
    expect(recorder.bulkUpdates.map((u) => u.ids)).toEqual([['q-poison', 'q-a', 'q-b']])
    expect(recorder.bulkUpdates[0]!.patch['retry_count']).toBeUndefined()
  })

  test('a single row failing with an unrecognised SQLSTATE is deferred, not charged', async () => {
    const recorder = setupSupabaseChains({
      deleteResult: { count: 0 },
      selectResult: { data: [threeRows[0]!], error: null },
    })
    pgQueryMock.mockRejectedValue(pgError('P0001', 'row rejected by trigger'))

    await replayFallbackQueue()

    expect(recorder.updates).toEqual([])
    expect(recorder.bulkUpdates.map((u) => u.ids)).toEqual([['q-poison']])
  })

  test('a Node socket error code is not mistaken for a SQLSTATE', async () => {
    // `EPIPE` is five uppercase letters, the same shape as a SQLSTATE. It is
    // the connection dropping, so the batch is deferred with no isolation pass.
    const recorder = setupSupabaseChains({
      deleteResult: { count: 0 },
      selectResult: { data: threeRows, error: null },
    })
    pgQueryMock.mockRejectedValue(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }))

    const result = await replayFallbackQueue()

    expect(pgQueryMock).toHaveBeenCalledOnce()
    expect(result.failed).toBe(3)
    expect(recorder.updates).toEqual([])
    expect(recorder.bulkUpdates.map((u) => u.ids)).toEqual([['q-poison', 'q-a', 'q-b']])
  })

  test.each([
    ['08006', 'connection failure'],
    ['25006', 'cannot execute INSERT in a read-only transaction'],
    ['53300', 'too many connections'],
    ['55P03', 'lock not available'],
    ['57014', 'canceling statement due to statement timeout'],
    ['XX000', 'internal error'],
  ])('database-side SQLSTATE %s defers the batch without an isolation pass', async (code, message) => {
    const recorder = setupSupabaseChains({
      deleteResult: { count: 0 },
      selectResult: { data: threeRows, error: null },
    })
    pgQueryMock.mockRejectedValue(pgError(code, message))

    await replayFallbackQueue()

    expect(pgQueryMock).toHaveBeenCalledOnce()
    expect(recorder.updates).toEqual([])
  })
})

describe('replayFallbackQueue — announcing replayed rows', () => {
  function queueOf(count: number): Array<{ id: string; payload: Record<string, unknown>; retry_count: number }> {
    return Array.from({ length: count }, (_, i) => ({
      id: `q-${i}`,
      payload: { id: `r-${i}`, organization_id: 'o1' },
      retry_count: 0,
    }))
  }

  test('retry bookkeeping is written before any request.created goes out', async () => {
    // If a slow subscriber runs the function out of time, the retry state of
    // the rows that did not land must already be saved.
    const recorder = setupSupabaseChains({
      deleteResult: { count: 0 },
      selectResult: {
        data: [
          { id: 'q-poison', payload: { id: 'p', organization_id: 'o1' }, retry_count: 2 },
          { id: 'q-a', payload: { id: 'a', organization_id: 'o1' }, retry_count: 0 },
        ],
        error: null,
      },
    })
    pgQueryMock.mockImplementation(async (opts: { params: Record<string, unknown> }) => {
      const ids = boundIds(opts.params)
      if (ids.includes('p')) throw pgError('23503', 'violates foreign key constraint')
      return ids.map((id) => ({ id }))
    })
    const updatesSeenAtFirstEmit: string[] = []
    emitRequestCreatedMock.mockImplementation(async () => {
      if (updatesSeenAtFirstEmit.length === 0) {
        updatesSeenAtFirstEmit.push(...recorder.updates.map((u) => u.id), 'emitted')
      }
    })

    await replayFallbackQueue()

    expect(updatesSeenAtFirstEmit).toEqual(['q-poison', 'emitted'])
  })

  test('dispatches run a few at a time rather than one after another', async () => {
    setupSupabaseChains({ deleteResult: { count: 0 }, selectResult: { data: queueOf(12), error: null } })
    let inFlight = 0
    let maxInFlight = 0
    emitRequestCreatedMock.mockImplementation(async () => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 5))
      inFlight -= 1
    })

    await replayFallbackQueue()

    expect(emitRequestCreatedMock).toHaveBeenCalledTimes(12)
    expect(maxInFlight).toBeGreaterThan(1)
    expect(maxInFlight).toBeLessThanOrEqual(5)
    expect(deferRequestCreatedMock).not.toHaveBeenCalled()
  })

  test('events not started when the time budget runs out are recorded as undelivered', async () => {
    // A subscriber that hangs costs each dispatch its full 10s timeout. Fifty
    // of those one after another would run past the function's 300s ceiling,
    // and everything after the kill would be lost without a delivery record.
    setupSupabaseChains({ deleteResult: { count: 0 }, selectResult: { data: queueOf(50), error: null } })
    let clock = 1_700_000_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => clock)
    emitRequestCreatedMock.mockImplementation(async () => {
      clock += 20_000
    })

    const result = await replayFallbackQueue()

    const emitted = emitRequestCreatedMock.mock.calls.map((c) => (c[0] as Record<string, unknown>)['id'])
    const deferred = deferRequestCreatedMock.mock.calls.map((c) => (c[0] as Record<string, unknown>)['id'])
    expect(result.replayed).toBe(50)
    expect(emitted.length).toBeLessThan(50)
    expect(deferred.length).toBeGreaterThan(0)
    // Every inserted row is announced exactly once, one way or the other.
    expect(new Set([...emitted, ...deferred]).size).toBe(50)
    expect(emitted.length + deferred.length).toBe(50)
    expect(String(deferRequestCreatedMock.mock.calls[0]![1])).toMatch(/time/i)
  })
})

describe('replayFallbackQueue — after rows land', () => {
  test('stamps the activity watermark once per organization whose rows were inserted', async () => {
    const fakeRows = [
      { id: 'q1', payload: { id: 'a', organization_id: 'o1' }, retry_count: 0 },
      { id: 'q2', payload: { id: 'b', organization_id: 'o1' }, retry_count: 0 },
      { id: 'q3', payload: { id: 'c', organization_id: 'o2' }, retry_count: 0 },
    ]
    setupSupabaseChains({ deleteResult: { count: 0 }, selectResult: { data: fakeRows, error: null } })

    await replayFallbackQueue()

    expect(recordOrgActivityMock.mock.calls.map((c) => c[0]).sort()).toEqual(['o1', 'o2'])
  })

  test('fires request.created for each inserted row, but not for one the conflict skipped', async () => {
    // A row that ON CONFLICT skipped was inserted, and announced, by an
    // earlier run whose queue DELETE blipped.
    const fakeRows = [
      { id: 'q1', payload: { id: 'a', organization_id: 'o1' }, retry_count: 0 },
      { id: 'q2', payload: { id: 'b', organization_id: 'o1' }, retry_count: 0 },
    ]
    setupSupabaseChains({ deleteResult: { count: 0 }, selectResult: { data: fakeRows, error: null } })
    pgQueryMock.mockResolvedValue([{ id: 'b' }])

    await replayFallbackQueue()

    expect(emitRequestCreatedMock).toHaveBeenCalledOnce()
    expect((emitRequestCreatedMock.mock.calls[0]![0] as Record<string, unknown>)['id']).toBe('b')
  })

  test('nothing is announced or watermarked when nothing landed', async () => {
    const fakeRows = [{ id: 'q1', payload: { id: 'a', organization_id: 'o1' }, retry_count: 0 }]
    setupSupabaseChains({ deleteResult: { count: 0 }, selectResult: { data: fakeRows, error: null } })
    pgQueryMock.mockRejectedValue(new Error('pooler unreachable'))

    await replayFallbackQueue()

    expect(emitRequestCreatedMock).not.toHaveBeenCalled()
    expect(recordOrgActivityMock).not.toHaveBeenCalled()
  })
})

describe('replayFallbackQueue — Supabase writes resolve with { error } (C8.1)', () => {
  test('a failed expiry delete is logged and the replay still runs', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const fakeRows = [{ id: 'q1', payload: { id: 'a', organization_id: 'o1' }, retry_count: 0 }]
    setupSupabaseChains({
      deleteResult: { count: null, error: { message: 'permission denied' } },
      selectResult: { data: fakeRows, error: null },
    })

    const result = await replayFallbackQueue()

    expect(result.expired).toBe(0)
    expect(result.replayed).toBe(1)
    expect(loggedKinds(errorSpy)).toContain('fallback_expiry_failed')
  })

  test('a failed queue delete after the batch landed is logged (the next run no-ops it)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const fakeRows = [{ id: 'q1', payload: { id: 'a', organization_id: 'o1' }, retry_count: 0 }]
    setupSupabaseChains({
      deleteResult: { count: 0 },
      selectResult: { data: fakeRows, error: null },
      batchDeleteResult: { error: { message: 'upstream connect error' } },
    })

    const result = await replayFallbackQueue()

    expect(result.replayed).toBe(1)
    expect(loggedKinds(errorSpy)).toContain('fallback_dequeue_failed')
  })

  test('a failed retry_count update is logged', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const fakeRows = [{ id: 'q1', payload: { id: 'p' }, retry_count: 0 }]
    setupSupabaseChains({
      deleteResult: { count: 0 },
      selectResult: { data: fakeRows, error: null },
      updateResult: { error: { message: 'timeout' } },
    })
    pgQueryMock.mockRejectedValue(pgError('23503', 'violates foreign key constraint'))

    await replayFallbackQueue()

    expect(loggedKinds(errorSpy)).toContain('fallback_retry_update_failed')
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
    dedupError?: { message: string } | null
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
          maybeSingle: vi.fn().mockResolvedValue({
            data: opts.existingAlert ?? null,
            error: opts.dedupError ?? null,
          }),
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

  test('alert insert resolving { error } is NOT reported as alerted', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const insertMock = setupBacklogChains({
      queueCount: 5000,
      insertMock: vi.fn().mockResolvedValue({ error: { message: 'internal_alerts unavailable' } }),
    })
    const r = await alertOnFallbackBacklog(1000)
    expect(insertMock).toHaveBeenCalledOnce()
    expect(r.alerted).toBe(false)
    expect(loggedKinds(errorSpy)).toContain('fallback_backlog_alert_failed')
  })

  test('dedup lookup resolving { error } skips the insert rather than risk an alert per run', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const insertMock = setupBacklogChains({
      queueCount: 5000,
      dedupError: { message: 'timeout' },
    })
    const r = await alertOnFallbackBacklog(1000)
    expect(insertMock).not.toHaveBeenCalled()
    expect(r.alerted).toBe(false)
    expect(loggedKinds(errorSpy)).toContain('fallback_backlog_alert_failed')
  })
})
