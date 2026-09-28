import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { pgQueryOne, pgStream, resetPostgresPool } from '../../lib/postgres.js'
import { PgStreamBusyError } from '../../lib/pg-stream-busy.js'

/**
 * Cursor lifetime against a real Postgres, for the backpressured export.
 *
 * A mocked driver cannot show any of this. The failure being pinned lives in
 * the server: node-postgres cursors send no Sync between batches, so
 * statement_timeout counts the whole cursor, pauses included, and a download
 * slower than the session timeout died partway through. Measured before the
 * fix with a 2s session timeout: reading 500 rows every 300ms failed at about
 * 2.5s every time; the same rows read without pausing succeeded every time.
 *
 * The session timeout is shrunk to one second here so the regression shows up
 * in a couple of seconds instead of a minute. PG_POOL_MAX=1 makes the shared
 * pool a single connection, so a cursor that borrowed it would visibly starve
 * the next query.
 */

const SESSION_TIMEOUT_MS = 1_000

beforeAll(async () => {
  await resetPostgresPool()
  vi.stubEnv('PG_STATEMENT_TIMEOUT_MS', String(SESSION_TIMEOUT_MS))
  vi.stubEnv('PG_POOL_MAX', '1')
})

afterAll(async () => {
  await resetPostgresPool()
  vi.unstubAllEnvs()
})

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

interface Row {
  i: number
  pid: number
}

/** Rows 1..n, each tagged with the backend that served it. */
function slowCursor(n: number, statementTimeoutMs?: number): AsyncGenerator<Row, void, undefined> {
  return pgStream<Row>({
    query: 'SELECT i, pg_backend_pid() AS pid FROM generate_series(1, {n}) AS i',
    params: { n },
    batchSize: 100,
    ...(statementTimeoutMs !== undefined ? { statementTimeoutMs } : {}),
  })
}

/** Reads everything, pausing after every 100 rows like a slow download. */
async function readSlowly(iter: AsyncIterable<Row>, pauseMs: number, seen: Row[]): Promise<void> {
  for await (const row of iter) {
    seen.push(row)
    if (seen.length % 100 === 0) await sleep(pauseMs)
  }
}

async function backendState(pid: number): Promise<{ state: string; in_xact: boolean }> {
  return pgQueryOne<{ state: string; in_xact: boolean }>({
    query: 'SELECT state, xact_start IS NOT NULL AS in_xact FROM pg_stat_activity WHERE pid = {pid}',
    params: { pid },
  })
}

describe('a cursor read slower than the session statement_timeout', () => {
  test('the session timeout is the shortened one', async () => {
    const row = await pgQueryOne<Record<string, string>>({ query: 'SHOW statement_timeout' })
    expect(Object.values(row)[0]).toBe('1s')
  })

  test('still delivers every row', async () => {
    // Six batches with 400ms pauses: about 2.4s, well past the 1s session
    // timeout. Before the fix this threw "canceling statement due to
    // statement timeout" after the second or third batch.
    const seen: Row[] = []
    await readSlowly(slowCursor(600), 400, seen)

    expect(seen).toHaveLength(600)
    expect(Number(seen[599]?.i)).toBe(600)
  })

  test('fails when its own budget is shorter than the read, which is what the session timeout used to do', async () => {
    // The mechanism, shown directly: the per-cursor budget covers the time
    // spent waiting on the consumer, not just time spent in the database.
    const seen: Row[] = []
    await expect(readSlowly(slowCursor(600, SESSION_TIMEOUT_MS), 400, seen)).rejects.toThrow(
      /statement timeout/,
    )
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.length).toBeLessThan(600)

    // The failed cursor's connection is not left inside an aborted
    // transaction for the next caller.
    const pid = Number(seen[0]?.pid)
    await sleep(50)
    expect(await backendState(pid)).toEqual({ state: 'idle', in_xact: false })
  })

  test('hands its connection back idle, outside any transaction', async () => {
    const seen: Row[] = []
    await readSlowly(slowCursor(300), 0, seen)
    const pid = Number(seen[0]?.pid)
    await sleep(50)
    expect(await backendState(pid)).toEqual({ state: 'idle', in_xact: false })
  })

  test('an abandoned cursor is rolled back and its connection handed back idle', async () => {
    const iter = slowCursor(100_000)
    const first = await iter.next()
    const pid = Number((first.value as Row).pid)
    expect(await backendState(pid)).toMatchObject({ in_xact: true })

    await iter.return(undefined)
    await sleep(50)
    expect(await backendState(pid)).toEqual({ state: 'idle', in_xact: false })
  })
})

describe('a paused cursor does not hold up the shared pool', () => {
  test('queries still run while a cursor waits on its consumer, and a second cursor is refused at once', async () => {
    const iter = slowCursor(100_000)
    await iter.next()
    try {
      // With PG_POOL_MAX=1, a cursor on the shared pool would leave this
      // query waiting ten seconds for a connection and then failing.
      const started = Date.now()
      const row = await pgQueryOne<{ ok: number }>({ query: 'SELECT 1 AS ok' })
      expect(Number(row.ok)).toBe(1)
      expect(Date.now() - started).toBeLessThan(2_000)

      const refusedAt = Date.now()
      await expect(slowCursor(10).next()).rejects.toBeInstanceOf(PgStreamBusyError)
      expect(Date.now() - refusedAt).toBeLessThan(500)
    } finally {
      await iter.return(undefined)
    }

    // The slot is free again once the first cursor is done.
    const seen: Row[] = []
    await readSlowly(slowCursor(10), 0, seen)
    expect(seen).toHaveLength(10)
  })
})
