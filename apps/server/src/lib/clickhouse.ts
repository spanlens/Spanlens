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
