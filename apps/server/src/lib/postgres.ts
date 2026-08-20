import { Pool, types, type PoolClient, type QueryResultRow } from 'pg'
import QueryStream from 'pg-query-stream'

/**
 * Direct Postgres access for the `requests` log table.
 *
 * Everything else in the server talks to Postgres through `supabaseAdmin` /
 * `supabaseClient` (PostgREST). That works well for row-shaped CRUD and is
 * still the right tool for it. It cannot express the analytics this table
 * needs — `percentile_cont`, `FILTER (WHERE …)`, `date_trunc` grouping,
 * lateral joins over jsonb — and it has no cursor, so a million-row CSV
 * export would have to be materialised in the function's heap.
 *
 * Hence a real driver, used *only* for `requests`. The ESLint rule in
 * apps/server/eslint.config.mjs keeps imports of this module inside
 * `src/lib/**`, and a source-guard test keeps that honest independently of
 * lint.
 *
 * ## Why a named-parameter shim
 *
 * The query helpers assemble WHERE clauses from arrays of fragments
 * (`lib/requests-query.ts`, `api/exports.ts`). Written against positional
 * `$1, $2, …`, every conditionally added filter renumbers the fragments after
 * it, which is exactly the kind of edit that produces an off-by-one that
 * still runs and silently returns the wrong tenant's rows.
 *
 * So the shim keeps names. Call sites write `{orgId}` and pass
 * `{ orgId: '…' }`; `toPositional` rewrites to `$n` right before execution.
 *
 * Values never reach the SQL string. A name with no matching parameter
 * throws rather than being substituted or ignored, so a typo fails loudly at
 * the first call instead of quietly widening a filter.
 *
 * ## Pooling
 *
 * Connections go through Supavisor in transaction mode (port 6543), the
 * pooler meant for serverless. Two consequences the code has to respect:
 * prepared statements are unsupported (node-postgres only uses them when a
 * query is given a `name`, so simply never name one), and each function
 * instance keeps a tiny pool — Vercel scales instances horizontally, so a
 * large per-instance pool multiplies into connection exhaustion rather than
 * throughput.
 */

/**
 * Postgres returns `timestamptz` as a local-time string by default, which
 * makes downstream `new Date(...)` parsing depend on the server's timezone.
 * Every timestamp in this system is UTC; hand back ISO strings so the API
 * boundary is unambiguous.
 */
types.setTypeParser(types.builtins.TIMESTAMPTZ, (value: string) => new Date(value).toISOString())

/**
 * `numeric` and `int8` arrive as strings, deliberately: neither fits in a JS
 * number without risking precision loss. So the rule (CLAUDE.md gotcha #19)
 * is: coerce with `Number()` at the API boundary, and never do arithmetic
 * against the raw value, because `"0.001" + 1` concatenates. Left as strings
 * on purpose; a global parser here would trade a visible bug for an
 * invisible one.
 */

const DEFAULT_STATEMENT_TIMEOUT_MS = 60_000
const DEFAULT_POOL_MAX = 2

let _pool: Pool | null = null

/**
 * Per-backend session setup, keyed weakly so a discarded client takes its
 * entry with it. Every checkout waits on this before issuing a statement, so
 * no query can run against a backend whose timezone and statement timeout are
 * still being installed.
 */
const SESSION_READY = new WeakMap<PoolClient, Promise<void>>()

/**
 * Checks out a client, waits for its session setup, runs `fn`, releases.
 *
 * Every path into the database goes through here so the wait cannot be
 * forgotten in one of them. Release happens in `finally`; a leaked client is
 * unusually expensive with a pool this small, since two of them is the whole
 * pool.
 */
async function withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool().connect()
  try {
    await SESSION_READY.get(client)
    return await fn(client)
  } finally {
    client.release()
  }
}

function readConnectionString(): string {
  const url = process.env['SUPABASE_DB_POOLER_URL']
  if (!url) {
    // Deliberately does not echo the value or any near-miss env var — a
    // connection string is a full database credential and must not reach a
    // log line, including from an error path.
    throw new Error('SUPABASE_DB_POOLER_URL is not configured')
  }
  return url
}

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

/**
 * The connection pool. Not exported — call sites use `pgQuery` / `pgStream`
 * so the parameter shim and the tenant-scoping helpers stay on the only
 * path in.
 */
function pool(): Pool {
  if (_pool) return _pool
  _pool = new Pool({
    connectionString: readConnectionString(),
    max: readPositiveInt('PG_POOL_MAX', DEFAULT_POOL_MAX),
    // Supavisor hands the backend to another client between transactions;
    // holding an idle connection open past a few seconds wastes a slot.
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    // No `options: '-c timezone=…'` here, deliberately. Passing server
    // settings through the startup packet is the obvious way to do this and
    // it does not survive a transaction pooler: pgbouncer-family poolers
    // parse the `options` parameter and either reject the connection
    // outright or drop it silently, and a silent drop is the bad case. The
    // settings are applied per-connection below instead.
  })

  // Applied once per new backend rather than in the startup packet.
  //
  // Timezone is the one that matters for correctness. `date_trunc('day', ts)`
  // on a timestamptz resolves against the session timezone, so a session in
  // Asia/Seoul buckets a 02:00Z request into the previous UTC day. Supabase's
  // server default is UTC, which makes this belt-and-braces rather than the
  // only line of defence, but the dashboard's day boundaries should not
  // depend on a default this code does not own.
  //
  // Rendering is already independent of it: every `to_char` in the query
  // layer casts `AT TIME ZONE 'UTC'` explicitly, so the printed timestamps
  // are correct even if this SET is discarded between transactions.
  //
  // The promise is recorded rather than left to run loose. `connect` fires
  // synchronously as the pool hands the client to whoever is waiting for it,
  // so without the handshake below the caller's first query is enqueued while
  // this one is still in flight. node-postgres tolerates that by queueing, but
  // it warns, and it is slated for removal in pg 9.
  _pool.on('connect', (client) => {
    const setup = client
      .query(
        `SET TIME ZONE 'UTC'; ` +
          `SET statement_timeout = ${readPositiveInt('PG_STATEMENT_TIMEOUT_MS', DEFAULT_STATEMENT_TIMEOUT_MS)}`,
      )
      .then(() => undefined)
      .catch((err: unknown) => {
        // A failed SET is not worth refusing the connection over: the queries
        // are still correct, they just run under the server's defaults.
        console.error(
          '[postgres] session setup failed:',
          err instanceof Error ? err.message : 'unknown error',
        )
      })
    SESSION_READY.set(client, setup)
  })
  _pool.on('error', (err) => {
    // An idle client erroring out is normal with a pooler in front; log it
    // without the connection string and let the pool replace the client.
    console.error('[postgres] idle client error:', err.message)
  })
  return _pool
}

/** Test hook. Closes the pool so a suite can swap the environment. */
export async function resetPostgresPool(): Promise<void> {
  const existing = _pool
  _pool = null
  if (existing) await existing.end()
}

export interface PgQuery {
  /** SQL with `{name}` placeholders. Never interpolate user values here. */
  readonly query: string
  /** Values for the placeholders. Missing names throw. */
  readonly params?: Readonly<Record<string, unknown>>
}

/**
 * Matches `{name}` placeholders. Names are restricted to identifier
 * characters so a stray brace in SQL (there are none today, but jsonb
 * literals could introduce one) cannot be mistaken for a placeholder.
 */
const PLACEHOLDER = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g

export interface PositionalQuery {
  readonly text: string
  readonly values: unknown[]
}

/**
 * Rewrites `{name}` placeholders to `$1, $2, …` and collects the values in
 * matching order. A name used twice reuses its position rather than binding
 * the value twice.
 *
 * Exported for tests: the rewrite is the one piece of this module where a
 * bug is both easy to introduce and invisible at runtime, since a wrong
 * mapping still produces valid SQL.
 */
export function toPositional(query: string, params: Readonly<Record<string, unknown>> = {}): PositionalQuery {
  const values: unknown[] = []
  const positions = new Map<string, number>()

  const text = query.replace(PLACEHOLDER, (_match, name: string) => {
    const known = positions.get(name)
    if (known !== undefined) return `$${known}`

    if (!Object.prototype.hasOwnProperty.call(params, name)) {
      throw new Error(`Missing SQL parameter: {${name}}`)
    }
    values.push(params[name])
    const index = values.length
    positions.set(name, index)
    return `$${index}`
  })

  return { text, values }
}

/**
 * Runs a query and returns its rows.
 *
 * No `name` is passed to node-postgres, so it never asks the server to
 * prepare the statement — required under Supavisor transaction mode.
 */
export async function pgQuery<T extends QueryResultRow>(opts: PgQuery): Promise<T[]> {
  const { text, values } = toPositional(opts.query, opts.params ?? {})
  const result = await withClient((client) => client.query<T>({ text, values }))
  return result.rows
}

/** Runs a query expected to return exactly one row, or throws. */
export async function pgQueryOne<T extends QueryResultRow>(opts: PgQuery): Promise<T> {
  const rows = await pgQuery<T>(opts)
  const row = rows[0]
  if (!row) throw new Error('Expected one row, got none')
  return row
}

/** Runs a statement for its effect and reports how many rows it touched. */
export async function pgExecute(opts: PgQuery): Promise<number> {
  const { text, values } = toPositional(opts.query, opts.params ?? {})
  const result = await withClient((client) => client.query({ text, values }))
  return result.rowCount ?? 0
}

/**
 * Runs several statements inside one transaction on one connection.
 *
 * Almost nothing here needs this: single statements get their own implicit
 * transaction and go through `pgQuery` / `pgExecute`. It exists for the cases
 * where a statement's effect depends on transaction scope, which in practice
 * means `SET LOCAL`. Sent on its own, `SET LOCAL` warns and does nothing, so
 * a caller trying to bound one statement's `lock_timeout` gets no bound at
 * all unless the two travel together.
 *
 * Supavisor's transaction mode keeps a backend assigned for the life of a
 * transaction, so BEGIN through COMMIT lands on one connection as required.
 * Rolls back and rethrows on any failure.
 */
export async function pgTransaction<T>(
  fn: (tx: (opts: PgQuery) => Promise<number>) => Promise<T>,
): Promise<T> {
  return withClient(async (client) => {
    try {
      await client.query('BEGIN')
      const tx = async (opts: PgQuery): Promise<number> => {
        const { text, values } = toPositional(opts.query, opts.params ?? {})
        const result = await client.query({ text, values })
        return result.rowCount ?? 0
      }
      const out = await fn(tx)
      await client.query('COMMIT')
      return out
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      throw err
    }
  })
}

export interface PgStreamOptions extends PgQuery {
  /** Rows fetched per round trip. Trades memory against round trips. */
  readonly batchSize?: number
}

const DEFAULT_STREAM_BATCH = 500

/**
 * Streams a result set through a server-side cursor.
 *
 * This is what makes the large CSV/JSONL export possible without holding the
 * whole result in memory, and it is half the reason this module exists at all
 * rather than everything going through PostgREST (the other half being the
 * analytic SQL above).
 *
 * The cursor holds one pooled connection for the life of the iteration, so
 * callers must finish or abandon it promptly; the `finally` releases the
 * client even when the consumer breaks out early.
 */
export async function* pgStream<T extends QueryResultRow>(
  opts: PgStreamOptions,
): AsyncGenerator<T, void, undefined> {
  const { text, values } = toPositional(opts.query, opts.params ?? {})
  // Not `withClient`: the cursor has to hold its client across yields, which
  // outlives any callback shape. The readiness wait is the same.
  const client: PoolClient = await pool().connect()
  try {
    await SESSION_READY.get(client)
    const stream = client.query(
      new QueryStream(text, values, { batchSize: opts.batchSize ?? DEFAULT_STREAM_BATCH }),
    )
    for await (const row of stream) {
      yield row as T
    }
  } finally {
    client.release()
  }
}

/**
 * Liveness probe for `/health`. Returns latency rather than a boolean so the
 * health endpoint can distinguish "slow" from "down".
 */
export async function pingPostgres(timeoutMs = 5_000): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const started = Date.now()
  try {
    // Inside a transaction, so `SET LOCAL` binds and then reverts at COMMIT.
    //
    // The obvious version of this (plain `SET`, then `RESET` in a `finally`)
    // is wrong in a way that hides itself: `RESET` restores the *role*
    // default, not the value the connect handler installed. Since the pooled
    // client outlives the probe, one health check would leave that connection
    // running with the role's timeout for every later query, and the only
    // symptom is queries that should have been cut off at a minute running to
    // two. Measured against the pooler: the ping was the reason a later
    // `SHOW statement_timeout` reported 2min instead of the configured 60s.
    await pgTransaction(async (tx) => {
      await tx({ query: `SET LOCAL statement_timeout = ${Math.max(1, Math.floor(timeoutMs))}` })
      await tx({ query: 'SELECT 1' })
    })
    return { ok: true, latencyMs: Date.now() - started }
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message : 'unknown error',
    }
  }
}
