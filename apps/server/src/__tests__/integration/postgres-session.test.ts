import { afterAll, describe, expect, test } from 'vitest'
import { pgQueryOne, pgTransaction, pgStream, pingPostgres, resetPostgresPool } from '../../lib/postgres.js'

/**
 * Session-state behaviour of the Postgres driver, checked against a real
 * server rather than a mock.
 *
 * Everything here is invisible to a mocked test by construction: a fake client
 * returns whatever it was told to return, so a query that quietly mutates the
 * session and a query that does not look identical from the outside. The bugs
 * in this area share a shape, where the statement succeeds and the damage
 * surfaces on some later query that happens to reuse the same pooled
 * connection.
 */

async function statementTimeout(): Promise<string> {
  const row = await pgQueryOne<Record<string, string>>({ query: 'SHOW statement_timeout' })
  return String(Object.values(row)[0])
}

afterAll(async () => {
  await resetPostgresPool()
})

describe('pooled session state', () => {
  test('the connect handler installs the configured statement_timeout', async () => {
    // 60s by default, which Postgres renders as "1min". Reading the role
    // default here instead would mean the settings the pool installs on a new
    // backend never arrive, and PG_STATEMENT_TIMEOUT_MS is decorative.
    expect(await statementTimeout()).toBe('1min')
  })

  test('a health check leaves the session timeout where it found it', async () => {
    // The regression this exists for: probing with a plain `SET` and undoing
    // it with `RESET` restores the *role* default, not the value the pool
    // installed. The ping passes, the health endpoint reports green, and from
    // then on that pooled connection runs with a different timeout than every
    // other one. Nothing surfaces it except a query that should have been cut
    // off and was not. Measured through the production pooler before the fix:
    // 2min instead of the configured 60s, for the life of the connection.
    const before = await statementTimeout()

    const result = await pingPostgres(5_000)
    expect(result.ok).toBe(true)

    expect(await statementTimeout()).toBe(before)
  })

  test('SET LOCAL binds inside a transaction and is gone after it', async () => {
    // Both halves matter. Bound-inside is what makes the partition job's
    // lock_timeout a real bound rather than a comment. Gone-after is what
    // stops one caller's setting from becoming every later caller's setting
    // on a connection they share.
    const matchedInside = await pgTransaction(async (tx) => {
      await tx({ query: 'SET LOCAL statement_timeout = 4321' })
      return tx({ query: `SELECT 1 WHERE current_setting('statement_timeout') = '4321ms'` })
    })
    expect(matchedInside).toBe(1)

    expect(await statementTimeout()).toBe('1min')
  })

  test('timestamps come back as UTC ISO strings regardless of the local clock', async () => {
    const row = await pgQueryOne<{ t: string }>({
      query: `SELECT '2026-08-20 01:02:03+00'::timestamptz AS t`,
    })
    expect(row.t).toBe('2026-08-20T01:02:03.000Z')
  })

  test('numeric and int8 still arrive as strings', async () => {
    // CLAUDE.md gotcha #19 survived the move off ClickHouse. Callers coerce at
    // the API boundary; a driver-level parser here would trade a visible bug
    // for a silent precision loss.
    const row = await pgQueryOne<{ n: unknown; c: unknown }>({
      query: 'SELECT 0.00012345::numeric(18,8) AS n, count(*) AS c FROM (SELECT 1) t',
    })
    expect(typeof row.n).toBe('string')
    expect(typeof row.c).toBe('string')
  })

  test('a cursor streams every row and releases its client when abandoned', async () => {
    const seen: number[] = []
    for await (const row of pgStream<{ i: number }>({
      query: 'SELECT i FROM generate_series(1, {n}) AS i',
      params: { n: 1200 },
      batchSize: 100,
    })) {
      seen.push(Number(row.i))
    }
    expect(seen).toHaveLength(1200)
    expect(seen[0]).toBe(1)
    expect(seen[1199]).toBe(1200)

    // Breaking out early is the export endpoint's normal path when a client
    // disconnects mid-download. If the `finally` failed to release, the pool
    // would be one connection poorer for the life of the instance, and with a
    // default pool of two that is halfway to a hang.
    for await (const row of pgStream<{ i: number }>({
      query: 'SELECT i FROM generate_series(1, 100000) AS i',
    })) {
      void row
      break
    }
    const after = await pgQueryOne<{ ok: number }>({ query: 'SELECT 1 AS ok' })
    expect(Number(after.ok)).toBe(1)
  })
})
