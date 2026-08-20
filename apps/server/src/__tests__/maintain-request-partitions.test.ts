import { beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * Partition upkeep for the `requests` table.
 *
 * This job exists because of a Postgres behaviour that turns a missed cron
 * into an outage rather than a delay. If a row arrives for a month that has
 * no partition, it lands in `requests_default`, and from then on creating the
 * real partition for that range FAILS: Postgres scans the default partition
 * under ACCESS EXCLUSIVE to prove nothing conflicts, and that scan blocks the
 * proxy's inserts while it runs.
 *
 * So the properties worth pinning are less about the happy path and more
 * about what the job does when something is already wrong: does it still
 * create next month's partitions when the drop half fails, does it notice
 * rows in the catch-all, and does it distinguish "old data lingers" from
 * "new data has nowhere to go".
 */

const pgQueryMock = vi.fn()
const pgExecuteMock = vi.fn()
const supabaseFromMock = vi.fn()
const logErrorMock = vi.fn()

vi.mock('../lib/postgres.js', () => ({
  pgQuery: (opts: unknown) => pgQueryMock(opts),
  pgExecute: (opts: unknown) => pgExecuteMock(opts),
  // The fallback detach runs inside a real transaction, because `SET LOCAL`
  // is inert outside one. The mock threads statements to the same spy so the
  // assertions below see the whole sequence, and records that a transaction
  // was opened at all.
  pgTransaction: (fn: (tx: (opts: unknown) => Promise<number>) => Promise<unknown>) => {
    transactionCount++
    return fn((opts: unknown) => pgExecuteMock(opts))
  },
}))

vi.mock('../lib/db.js', () => ({
  supabaseAdmin: { from: (t: string) => supabaseFromMock(t) },
}))

vi.mock('../lib/structured-logger.js', () => ({
  logError: (...args: unknown[]) => logErrorMock(...args),
}))

const { maintainRequestPartitions } = await import('../lib/cron-jobs/maintain-request-partitions.js')

/** No unresolved alert of this kind, and the insert succeeds. */
function alertsChainClean() {
  return {
    select: () => ({
      eq: () => ({
        is: () => ({
          limit: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }),
        }),
      }),
    }),
    insert: (row: unknown) => {
      alertInserts.push(row)
      return Promise.resolve({ error: null })
    },
  }
}

let alertInserts: unknown[] = []
let transactionCount = 0

/**
 * The job issues three reads in a fixed order: ensure_requests_partitions,
 * the default-partition count, then the stale-partition list.
 */
function wireQueries(opts: {
  ensured?: Array<{ partition_name: string; created: boolean }>
  defaultRows?: string
  stale?: Array<{ partition_name: string }>
  failOn?: 'ensure' | 'count' | 'stale'
}) {
  pgQueryMock.mockImplementation(({ query }: { query: string }) => {
    if (query.includes('ensure_requests_partitions')) {
      if (opts.failOn === 'ensure') return Promise.reject(new Error('function missing'))
      return Promise.resolve(opts.ensured ?? [])
    }
    if (query.includes('requests_default')) {
      if (opts.failOn === 'count') return Promise.reject(new Error('count failed'))
      return Promise.resolve([{ n: opts.defaultRows ?? '0' }])
    }
    if (query.includes('pg_inherits')) {
      if (opts.failOn === 'stale') return Promise.reject(new Error('catalog read failed'))
      return Promise.resolve(opts.stale ?? [])
    }
    throw new Error(`unexpected query: ${query}`)
  })
}

beforeEach(() => {
  pgQueryMock.mockReset()
  pgExecuteMock.mockReset()
  supabaseFromMock.mockReset()
  logErrorMock.mockReset()
  alertInserts = []
  transactionCount = 0
  pgExecuteMock.mockResolvedValue(0)
  supabaseFromMock.mockReturnValue(alertsChainClean())
})

describe('maintainRequestPartitions', () => {
  test('reports only the partitions it actually created', async () => {
    wireQueries({
      ensured: [
        { partition_name: 'requests_2026_08', created: false },
        { partition_name: 'requests_2026_09', created: true },
      ],
    })

    const result = await maintainRequestPartitions()

    // The already-present month is not news. Reporting it would make every
    // run look like it did work and hide the run that genuinely did.
    expect(result.created).toEqual(['requests_2026_09'])
    expect(result.createError).toBeUndefined()
  })

  test('builds several months ahead, not just next month', async () => {
    // One missed firing should cost nothing. Vercel's scheduler has gone days
    // without running before, and the recovery from a missed partition is
    // expensive enough that the buffer is the whole point.
    wireQueries({ ensured: [] })
    await maintainRequestPartitions()

    const call = pgQueryMock.mock.calls.find((c) =>
      (c[0] as { query: string }).query.includes('ensure_requests_partitions'),
    )
    expect((call?.[0] as { params: { months: number } }).params.months).toBeGreaterThanOrEqual(3)
  })

  test('drops a stale partition by detaching first, then dropping', async () => {
    wireQueries({ stale: [{ partition_name: 'requests_2024_01' }] })

    const result = await maintainRequestPartitions()

    expect(result.dropped).toEqual(['requests_2024_01'])
    const statements = pgExecuteMock.mock.calls.map((c) => (c[0] as { query: string }).query)
    const detachAt = statements.findIndex((s) => s.includes('DETACH PARTITION'))
    const dropAt = statements.findIndex((s) => s.startsWith('DROP TABLE'))
    expect(detachAt).toBeGreaterThanOrEqual(0)
    expect(dropAt).toBeGreaterThan(detachAt)
  })

  test('prefers CONCURRENTLY so a detach cannot start a lock convoy', async () => {
    wireQueries({ stale: [{ partition_name: 'requests_2024_01' }] })
    await maintainRequestPartitions()

    const first = (pgExecuteMock.mock.calls[0]?.[0] as { query: string }).query
    expect(first).toContain('DETACH PARTITION')
    expect(first).toContain('CONCURRENTLY')
  })

  test('falls back to a lock_timeout-guarded detach when CONCURRENTLY is refused', async () => {
    // Postgres rejects DETACH CONCURRENTLY inside a transaction block with
    // 25001. Whether the statement arrives in one depends on the connection
    // path, so the job has to cope rather than assume.
    wireQueries({ stale: [{ partition_name: 'requests_2024_01' }] })
    let seenConcurrent = false
    pgExecuteMock.mockImplementation(({ query }: { query: string }) => {
      if (query.includes('CONCURRENTLY')) {
        seenConcurrent = true
        return Promise.reject(Object.assign(new Error('cannot run inside a transaction block'), { code: '25001' }))
      }
      return Promise.resolve(0)
    })

    const result = await maintainRequestPartitions()

    expect(seenConcurrent).toBe(true)
    const statements = pgExecuteMock.mock.calls.map((c) => (c[0] as { query: string }).query)
    expect(statements.some((s) => s.includes('lock_timeout'))).toBe(true)
    // The timeout has to be inside a transaction to bind at all. `SET LOCAL`
    // sent on its own warns and does nothing, which would leave the detach
    // waiting behind a long query with the proxy's writes queued behind it.
    // Counting the statement is not enough; it has to be wrapped.
    expect(transactionCount).toBe(1)
    expect(result.dropped).toEqual(['requests_2024_01'])
  })

  test('a detach failure that is not 25001 stops the drop half', async () => {
    wireQueries({ stale: [{ partition_name: 'requests_2024_01' }] })
    pgExecuteMock.mockImplementation(({ query }: { query: string }) => {
      if (query.includes('DETACH')) {
        return Promise.reject(Object.assign(new Error('permission denied'), { code: '42501' }))
      }
      return Promise.resolve(0)
    })

    const result = await maintainRequestPartitions()

    // Never DROP a partition we failed to detach.
    expect(result.dropped).toEqual([])
    expect(result.dropError).toContain('permission denied')
  })

  test('a failed drop does not stop partitions from being created', async () => {
    // These are the two halves that must not share a fate. Failing to reclaim
    // old space is an annoyance; failing to create next month's partition is
    // an outage in waiting.
    wireQueries({
      ensured: [{ partition_name: 'requests_2026_09', created: true }],
      failOn: 'stale',
    })

    const result = await maintainRequestPartitions()

    expect(result.created).toEqual(['requests_2026_09'])
    expect(result.dropError).toContain('catalog read failed')
    expect(result.createError).toBeUndefined()
  })

  test('a failed create is reported separately so the run can be marked failed', async () => {
    wireQueries({ failOn: 'ensure', stale: [] })

    const result = await maintainRequestPartitions()

    expect(result.createError).toContain('function missing')
    expect(result.created).toEqual([])
  })

  test('rows in the catch-all partition raise an alert', async () => {
    wireQueries({ defaultRows: '7' })

    const result = await maintainRequestPartitions()

    expect(result.defaultPartitionRows).toBe(7)
    expect(alertInserts).toHaveLength(1)
    expect(alertInserts[0]).toMatchObject({ kind: 'requests_default_partition', severity: 'error' })
  })

  test('an empty catch-all raises nothing', async () => {
    wireQueries({ defaultRows: '0' })

    const result = await maintainRequestPartitions()

    expect(result.defaultPartitionRows).toBe(0)
    expect(alertInserts).toHaveLength(0)
  })

  test('does not file a second alert while one is still unresolved', async () => {
    // The job runs daily; a month-long incident should not produce 30 rows.
    wireQueries({ defaultRows: '7' })
    supabaseFromMock.mockReturnValue({
      select: () => ({
        eq: () => ({
          is: () => ({
            limit: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 'existing' } }) }),
          }),
        }),
      }),
      insert: (row: unknown) => {
        alertInserts.push(row)
        return Promise.resolve({ error: null })
      },
    })

    await maintainRequestPartitions()

    expect(alertInserts).toHaveLength(0)
  })

  test('the count is coerced from the driver string', async () => {
    // int8 comes back as a string (CLAUDE.md gotcha #19). Left uncoerced,
    // `'0' > 0` is false but `'0'` is truthy, so the alert branch would fire
    // on an empty partition.
    wireQueries({ defaultRows: '0' })
    const result = await maintainRequestPartitions()
    expect(result.defaultPartitionRows).toBe(0)
    expect(typeof result.defaultPartitionRows).toBe('number')
  })

  test('refuses to interpolate a partition name that is not an identifier', async () => {
    wireQueries({ stale: [{ partition_name: 'requests_2024_01"; DROP TABLE requests; --' }] })

    const result = await maintainRequestPartitions()

    expect(result.dropped).toEqual([])
    expect(result.dropError).toContain('refusing to interpolate')
    const statements = pgExecuteMock.mock.calls.map((c) => (c[0] as { query: string }).query)
    expect(statements.some((s) => s.includes('DROP TABLE requests;'))).toBe(false)
  })
})
