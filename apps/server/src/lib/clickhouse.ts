import { createClient, type ClickHouseClient } from '@clickhouse/client'

/**
 * ClickHouse client singleton.
 *
 * Holds the `requests` table — high-volume LLM call logs. Everything else
 * (auth, organizations, projects, traces, spans, prompts, evals, billing)
 * stays in Supabase. See docs/plans/clickhouse-migration.md.
 *
 * Local dev: `docker compose up clickhouse` brings up a container with the
 * default credentials from .env.example. Production: ClickHouse Cloud URL.
 *
 * RLS does NOT exist here. Every read must filter `organization_id`
 * explicitly — see `lib/requests-query.ts` for the canonical helper.
 */

let _client: ClickHouseClient | null = null

interface ClickhouseEnv {
  url: string
  username: string
  password: string
  database: string
}

function readEnv(): ClickhouseEnv {
  const url = process.env['CLICKHOUSE_URL']
  const username = process.env['CLICKHOUSE_USER']
  const password = process.env['CLICKHOUSE_PASSWORD']
  const database = process.env['CLICKHOUSE_DB'] ?? 'spanlens'

  if (!url) throw new Error('CLICKHOUSE_URL is not configured')
  if (!username) throw new Error('CLICKHOUSE_USER is not configured')
  if (!password) throw new Error('CLICKHOUSE_PASSWORD is not configured')

  return { url, username, password, database }
}

export function getClickhouse(): ClickHouseClient {
  if (_client) return _client
  const env = readEnv()
  _client = createClient({
    url: env.url,
    username: env.username,
    password: env.password,
    database: env.database,
    compression: { request: true, response: true },
    clickhouse_settings: {
      // async_insert lets the server batch INSERTs server-side, which is the
      // recommended pattern for high-volume log ingestion. wait_for_async_insert=0
      // means the INSERT returns as soon as the buffer accepts the row, not
      // when it's actually flushed. We accept a tiny latency window for a
      // ~10x throughput win — acceptable because logs are fire-and-forget.
      async_insert: 1,
      wait_for_async_insert: 0,
      // Forward-compat safety net: if the code starts sending a column that
      // the deployed table doesn't have yet (i.e. a new column landed in
      // logger.ts before the matching migration ran), skip the unknown field
      // silently instead of failing the entire INSERT. Without this every
      // streaming request would error out on the deploy → migration window —
      // exactly the regression P2.2's `truncated` column would have caused
      // if shipped before its ClickHouse migration was applied.
      // Trade-off: an actual typo in a column name fails silently and the
      // data never lands. Accepted because the alternative is a logging
      // outage every time a migration trails a deploy.
      input_format_skip_unknown_fields: 1,
    },
  })
  return _client
}

/**
 * Test helper: clears the singleton so a new client is built on next call.
 * Useful when env vars change between tests.
 */
export function resetClickhouseClient(): void {
  _client = null
}

/**
 * Health probe — returns true if ClickHouse is reachable and responding.
 * Used by /health endpoint and migration scripts.
 */
export async function pingClickhouse(): Promise<boolean> {
  try {
    const result = await getClickhouse().ping()
    return result.success
  } catch {
    return false
  }
}

/**
 * Returns the raw ClickHouse client scoped to a specific organization.
 *
 * This is a thin helper that pairs `getClickhouse()` with the caller's
 * `organizationId` so API/middleware code must explicitly declare the org
 * rather than calling the bare singleton. It does NOT automatically inject
 * the WHERE clause — callers still write `organization_id = {orgId:UUID}` —
 * but it makes the required scoping explicit at the call site.
 *
 * For higher-level helpers that fully handle scoping, prefer
 * `requestsScope` / `selectRequests` / `countRequests` from
 * `lib/requests-query.ts`.
 *
 * Usage:
 *   const { client, orgId } = getOrgClickhouse(organizationId)
 *   const result = await client.query({
 *     query: 'SELECT id FROM requests WHERE organization_id = {orgId:UUID} AND ...',
 *     query_params: { orgId, ... },
 *     format: 'JSONEachRow',
 *   })
 */
export function getOrgClickhouse(organizationId: string): { client: ClickHouseClient; orgId: string } {
  return { client: getClickhouse(), orgId: organizationId }
}

/**
 * Formats a Date for a ClickHouse `DateTime64(3, 'UTC')` column.
 *
 * `Date.toISOString()` produces `2026-05-16T11:49:23.749Z`, but ClickHouse's
 * JSONEachRow parser only accepts `2026-05-16 11:49:23.749` (space separator,
 * no trailing `Z`). Sending the Z form causes a `CANNOT_PARSE_INPUT_ASSERTION_FAILED`
 * error on every insert.
 */
export function toClickhouseTimestamp(date: Date = new Date()): string {
  return date.toISOString().replace('T', ' ').replace('Z', '')
}

/**
 * Inverse of `toClickhouseTimestamp` — converts a ClickHouse DateTime64 string
 * (`'YYYY-MM-DD HH:MM:SS.fff'`) back to an ISO-8601 UTC string ending in `Z`
 * so client JS `new Date(...)` parses it as UTC, not local time.
 *
 * Symptom of forgetting this on the wire boundary: rows show up "9h ago"
 * (KST offset) when they were actually created seconds ago — JS without the
 * `Z` interprets the timestamp as local time. See CLAUDE.md gotcha #18.
 *
 * Returns null for null/empty input so callers can pass through nullable
 * timestamp columns without extra branching.
 */
export function fromClickhouseTimestamp(s: string | null | undefined): string | null {
  if (!s) return null
  // ClickHouse format: '2026-05-20 07:00:00.000' → '2026-05-20T07:00:00.000Z'
  return s.replace(' ', 'T') + 'Z'
}
