import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// pgStream: how an export cursor uses its connection.
//
// Pins the two review findings on the backpressured export (XVERIFY-2026-09-28
// C10.1 follow-up):
//
//  1. A cursor paced by the consumer lives as long as the download, and
//     node-postgres cursors never send Sync between batches, so the server's
//     statement_timeout clock runs from the first batch to the last one,
//     consumer pauses included. The connection-wide 60s timeout therefore
//     killed any export that took a minute to download. The cursor now runs in
//     its own transaction under a `SET LOCAL statement_timeout` sized to the
//     function budget, which reverts at the end of the transaction.
//
//  2. The cursor used to sit on one of the two connections the proxy's request
//     logging and every dashboard read share. It now checks out from a
//     separate pool, and a stream that finds every slot taken fails at once
//     instead of queueing for a connection.
//
// The driver is faked here, so this proves which statements are sent and in
// what order. That the server honours them is proven against a real Postgres
// in integration/postgres-cursor.test.ts.
// ─────────────────────────────────────────────────────────────────────────────

interface StreamPlan {
  rows: Array<Record<string, unknown>>
  /** Throw after this many rows, like a statement timeout mid-cursor. */
  failAfter?: number
}

// Hoisted: the vi.mock factories below run before this module's body, so the
// fakes and the state they share have to exist by then.
const fake = vi.hoisted(() => {
  const state = {
    pools: [] as FakePool[],
    plan: { rows: [] } as StreamPlan,
    nextClientFailsOn: null as RegExp | null,
  }

  async function* runCursor(p: StreamPlan): AsyncGenerator<Record<string, unknown>, void, undefined> {
    let sent = 0
    for (const row of p.rows) {
      if (p.failAfter !== undefined && sent >= p.failAfter) {
        throw new Error('canceling statement due to statement timeout')
      }
      sent++
      yield row
    }
  }

  class FakeQueryStream {
    constructor(
      readonly text: string,
      readonly values: unknown[],
      readonly config: { batchSize?: number },
    ) {}
  }

  class FakeClient {
    readonly sql: string[] = []
    released: { withError: boolean } | null = null
    failOn: RegExp | null = null

    query(arg: unknown): unknown {
      if (arg instanceof FakeQueryStream) {
        this.sql.push(`CURSOR ${arg.text}`)
        return runCursor(state.plan)
      }
      const text = typeof arg === 'string' ? arg : (arg as { text: string }).text
      this.sql.push(text)
      if (this.failOn?.test(text)) return Promise.reject(new Error('Connection terminated'))
      return Promise.resolve({ rows: [], rowCount: 0 })
    }

    release(err?: unknown): void {
      this.released = { withError: Boolean(err) }
    }
  }

  class FakePool {
    readonly clients: FakeClient[] = []
    private onConnect: ((client: FakeClient) => void) | null = null

    constructor(readonly config: { max: number }) {
      state.pools.push(this)
    }

    on(event: string, handler: (client: FakeClient) => void): this {
      if (event === 'connect') this.onConnect = handler
      return this
    }

    async connect(): Promise<FakeClient> {
      const client = new FakeClient()
      if (state.nextClientFailsOn) {
        client.failOn = state.nextClientFailsOn
        state.nextClientFailsOn = null
      }
      this.clients.push(client)
      this.onConnect?.(client)
      return client
    }

    async end(): Promise<void> {}
  }

  return { state, FakePool, FakeQueryStream }
})

type FakeClient = Awaited<ReturnType<InstanceType<typeof fake.FakePool>['connect']>>

vi.mock('pg', () => ({
  Pool: fake.FakePool,
  types: { setTypeParser: () => {}, builtins: { TIMESTAMPTZ: 1184 } },
}))
vi.mock('pg-query-stream', () => ({ default: fake.FakeQueryStream }))

import { pgQuery, pgStream, resetPostgresPool } from '../lib/postgres.js'
import { PgStreamBusyError, isPgStreamBusyError } from '../lib/pg-stream-busy.js'

const SESSION_SETUP = /^SET TIME ZONE 'UTC'; SET statement_timeout = \d+$/

/** Statements the cursor's client ran after its connection setup. */
function cursorStatements(client: FakeClient): string[] {
  return client.sql.filter((s) => !SESSION_SETUP.test(s))
}

function streamClients(): FakeClient[] {
  return fake.state.pools.flatMap((p) => (p.config.max === streamPoolMax() ? p.clients : []))
}

function streamPoolMax(): number {
  return Number(process.env['PG_STREAM_POOL_MAX'] ?? 1)
}

async function drain<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const row of iter) out.push(row)
  return out
}

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ i }))

beforeEach(() => {
  vi.stubEnv('SUPABASE_DB_POOLER_URL', 'postgresql://user:pass@localhost:6543/postgres')
  fake.state.pools = []
  fake.state.plan = { rows: rows(3) }
  fake.state.nextClientFailsOn = null
})

afterEach(async () => {
  await resetPostgresPool()
  vi.unstubAllEnvs()
})

describe('the cursor runs in its own transaction with its own statement timeout', () => {
  test('BEGIN, SET LOCAL, cursor, COMMIT, in that order, then a clean release', async () => {
    const out = await drain(pgStream<{ i: number }>({ query: 'SELECT i FROM t WHERE org = {org}', params: { org: 'o1' } }))

    expect(out).toEqual(rows(3))
    const [client] = streamClients()
    expect(client).toBeDefined()
    expect(cursorStatements(client!)).toEqual([
      'BEGIN',
      'SET LOCAL statement_timeout = 290000',
      'CURSOR SELECT i FROM t WHERE org = $1',
      'COMMIT',
    ])
    expect(client!.released).toEqual({ withError: false })
  })

  test('the timeout can be set per call and by PG_STREAM_STATEMENT_TIMEOUT_MS', async () => {
    await drain(pgStream({ query: 'SELECT 1', statementTimeoutMs: 1234 }))
    vi.stubEnv('PG_STREAM_STATEMENT_TIMEOUT_MS', '45000')
    await drain(pgStream({ query: 'SELECT 2' }))

    const [first, second] = streamClients()
    expect(cursorStatements(first!)).toContain('SET LOCAL statement_timeout = 1234')
    expect(cursorStatements(second!)).toContain('SET LOCAL statement_timeout = 45000')
  })

  test('abandoning the iteration rolls back before the client goes back to the pool', async () => {
    // The export's normal path when a download is cancelled. A client returned
    // with its transaction still open would run the next caller's statements
    // inside it.
    fake.state.plan = { rows: rows(100) }
    const iter = pgStream({ query: 'SELECT i FROM t' })
    await iter.next()
    await iter.return(undefined)

    const [client] = streamClients()
    expect(cursorStatements(client!).slice(-1)).toEqual(['ROLLBACK'])
    expect(cursorStatements(client!)).not.toContain('COMMIT')
    expect(client!.released).toEqual({ withError: false })
  })

  test('a cursor that fails midway rolls back and rethrows', async () => {
    fake.state.plan = { rows: rows(10), failAfter: 4 }
    await expect(drain(pgStream({ query: 'SELECT i FROM t' }))).rejects.toThrow(/statement timeout/)

    const [client] = streamClients()
    expect(cursorStatements(client!).slice(-1)).toEqual(['ROLLBACK'])
    expect(client!.released).toEqual({ withError: false })
  })

  test('a client whose transaction cannot be ended is discarded, not reused', async () => {
    fake.state.plan = { rows: rows(10), failAfter: 2 }
    fake.state.nextClientFailsOn = /^ROLLBACK$/
    await expect(drain(pgStream({ query: 'SELECT i FROM t' }))).rejects.toThrow(/statement timeout/)

    const [client] = streamClients()
    expect(client!.released).toEqual({ withError: true })
  })
})

describe('cursors do not borrow from the shared pool', () => {
  test('pgStream checks out from its own pool, sized PG_STREAM_POOL_MAX', async () => {
    await pgQuery({ query: 'SELECT 1' })
    await drain(pgStream({ query: 'SELECT i FROM t' }))

    expect(fake.state.pools).toHaveLength(2)
    const [shared, stream] = fake.state.pools
    expect(shared!.config.max).toBe(2)
    expect(shared!.clients).toHaveLength(1)
    expect(stream!.config.max).toBe(1)
    expect(stream!.clients).toHaveLength(1)
  })

  test('a stream that finds every slot taken fails at once without asking for a connection', async () => {
    fake.state.plan = { rows: rows(100) }
    const first = pgStream({ query: 'SELECT i FROM t' })
    await first.next()

    const second = pgStream({ query: 'SELECT i FROM t' })
    const err = await second.next().then(
      () => null,
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(PgStreamBusyError)
    expect(isPgStreamBusyError(err)).toBe(true)
    expect(streamClients()).toHaveLength(1)

    // Finishing the first frees the slot for the next one.
    await first.return(undefined)
    const third = pgStream({ query: 'SELECT i FROM t' })
    await expect(third.next()).resolves.toMatchObject({ done: false })
    await third.return(undefined)
    expect(streamClients()).toHaveLength(2)
  })

  test('a failed stream gives its slot back', async () => {
    fake.state.plan = { rows: rows(10), failAfter: 1 }
    await expect(drain(pgStream({ query: 'SELECT i FROM t' }))).rejects.toThrow()
    fake.state.plan = { rows: rows(2) }
    await expect(drain(pgStream({ query: 'SELECT i FROM t' }))).resolves.toHaveLength(2)
  })

  test('PG_STREAM_POOL_MAX raises the number of concurrent cursors', async () => {
    vi.stubEnv('PG_STREAM_POOL_MAX', '2')
    fake.state.plan = { rows: rows(100) }
    const a = pgStream({ query: 'SELECT i FROM t' })
    const b = pgStream({ query: 'SELECT i FROM t' })
    await a.next()
    await expect(b.next()).resolves.toMatchObject({ done: false })
    const c = pgStream({ query: 'SELECT i FROM t' })
    await expect(c.next()).rejects.toBeInstanceOf(PgStreamBusyError)
    await a.return(undefined)
    await b.return(undefined)
  })
})
