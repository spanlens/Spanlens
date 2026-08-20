/**
 * Seed the last 24 hours with dense traffic so the default dashboard window
 * (24h) is populated. Complements seed-demo-data.ts, which spreads 30 days of
 * history but leaves the most recent hours nearly empty.
 *
 * Run: pnpm --filter server exec tsx ../../scripts/seed-recent-traffic.ts
 *
 * Target workspace is overridable: SEED_ORG_ID / SEED_PROJECT_ID /
 * SEED_API_KEY_ID. Defaults point at the local demo@spanlens.io workspace.
 */

import { createClient } from '@supabase/supabase-js'
import crypto from 'node:crypto'

function required(name: string, fallback: string): string {
  const value = process.env[name]?.trim()
  return value && value.length > 0 ? value : fallback
}

const ORG_ID = required('SEED_ORG_ID', '5d98e450-b0a8-4361-bc8e-c30be1992983')
const PROJECT_ID = required('SEED_PROJECT_ID', 'f00e80cf-6d94-4281-98ba-e731063463fb')
const API_KEY_ID = required('SEED_API_KEY_ID', 'fed8bdde-b4b2-4646-a9a3-74d1ea44d3ac')

const sb = createClient(
  required('SUPABASE_URL', 'http://127.0.0.1:54321'),
  required(
    'SUPABASE_SERVICE_ROLE_KEY',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU',
  ),
)

// `requests` is not reachable through PostgREST; the server reads and writes it
// over the pooled connection in apps/server/src/lib/postgres.ts, which builds
// its pool from this variable and refuses to run without one. Assigned before
// that module is imported, so the ordering is a property of this file rather
// than of whenever the pool first happens to be constructed.
process.env['SUPABASE_DB_POOLER_URL'] = required(
  'SUPABASE_DB_POOLER_URL',
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
)

// Through the lib rather than a local pg.Pool: its named-parameter shim is the
// only sanctioned way to bind values into a `requests` statement, and a second
// pool carrying its own timezone and timeout settings would drift from the one
// the server actually uses.
type PostgresLib = typeof import('../apps/server/src/lib/postgres.js')
let pg: PostgresLib

const uuid = () => crypto.randomUUID()
const rand = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min
// crypto.randomInt rather than Math.random: see the same helper in
// seed-demo-data.ts (CodeQL js/insecure-randomness on seeded identifiers).
const pick = <T>(arr: T[]): T => arr[crypto.randomInt(arr.length)]!

/** Columns stored as jsonb, whose bound string needs an explicit cast. */
const JSONB_COLUMNS = new Set(['flags', 'response_flags'])

/**
 * Rows per INSERT. Postgres binds at most 65535 parameters per statement and a
 * `requests` row carries 31 columns, so the hard ceiling is around 2100 rows.
 * 500 sits far enough under it that adding columns never has to be weighed
 * against this number, and it keeps one statement's prompt and response bodies
 * to a few hundred kilobytes rather than tens of megabytes.
 */
const BATCH_ROWS = 500

const PROVIDERS = [
  { provider: 'openai', models: ['gpt-4o', 'gpt-4o-mini-2024-07-18', 'o1-mini'] },
  {
    provider: 'anthropic',
    models: ['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
  },
  { provider: 'gemini', models: ['gemini-2.5-pro', 'gemini-2.0-flash'] },
]
const USERS = ['user_alice', 'user_bob', 'user_carol', 'user_dave', 'user_eve', 'user_frank']
const SESSIONS = Array.from({ length: 20 }, (_, i) => `sess_${String(i + 1).padStart(3, '0')}`)
const PRICES: Record<string, { inp: number; out: number }> = {
  'gpt-4o': { inp: 0.0000025, out: 0.00001 },
  'gpt-4o-mini-2024-07-18': { inp: 0.00000015, out: 0.0000006 },
  'o1-mini': { inp: 0.000003, out: 0.000012 },
  'claude-opus-4-8': { inp: 0.000015, out: 0.000075 },
  'claude-sonnet-4-6': { inp: 0.000003, out: 0.000015 },
  'claude-haiku-4-5-20251001': { inp: 0.00000025, out: 0.00000125 },
  'gemini-2.5-pro': { inp: 0.00000125, out: 0.00001 },
  'gemini-2.0-flash': { inp: 0.0000001, out: 0.0000004 },
}

/**
 * Requests per hour, indexed by hours-ago (0 = current hour).
 * Shaped like real product traffic: a daytime plateau, a quiet night, and a
 * busy current hour so the "last 1h" view is not empty either.
 */
function volumeForHoursAgo(hoursAgo: number): number {
  const hourOfDay = (new Date(Date.now() - hoursAgo * 3_600_000).getHours() + 24) % 24
  const daytime = hourOfDay >= 9 && hourOfDay <= 22
  const base = daytime ? rand(22, 38) : rand(6, 14)
  return hoursAgo === 0 ? Math.max(base, 18) : base
}

/**
 * Makes sure a monthly partition exists for every row about to be written.
 *
 * A row whose month has no partition lands in `requests_default`, and from that
 * point on creating the real partition for that range fails until someone
 * detaches the catch-all and drains it, holding ACCESS EXCLUSIVE on the parent
 * while the proxy is trying to write. Cheap to avoid, expensive to undo.
 *
 * The window here is 24 hours, which crosses a month boundary once a month, so
 * the previous month has to exist too. The verification afterwards is not
 * redundant with the call: it turns a partition the function somehow did not
 * create into a refusal rather than a silent incident.
 */
async function ensurePartitionsFor(oldest: Date): Promise<void> {
  await pg.pgQuery({
    query: 'SELECT * FROM ensure_requests_partitions({ahead}, {back})',
    params: { ahead: 3, back: 1 },
  })

  const rows = await pg.pgQuery<{ covered: boolean }>({
    query: `
      SELECT to_regclass(
               'public.requests_' || to_char({oldest}::timestamptz AT TIME ZONE 'UTC', 'YYYY_MM')
             ) IS NOT NULL AS covered
    `,
    params: { oldest: oldest.toISOString() },
  })

  if (!rows[0]?.covered) {
    throw new Error(
      `No partition covers ${oldest.toISOString()}; create the preceding month's partition before seeding.`,
    )
  }
}

/** One multi-row INSERT. Values are bound, never interpolated into the SQL. */
async function insertRequestBatch(rows: Record<string, unknown>[]): Promise<void> {
  const columns = Object.keys(rows[0]!)
  const values: string[] = []
  const params: Record<string, unknown> = {}

  rows.forEach((row, i) => {
    const placeholders = columns.map((col) => {
      const name = `v${i}_${col}`
      params[name] = row[col]
      return JSONB_COLUMNS.has(col) ? `{${name}}::jsonb` : `{${name}}`
    })
    values.push(`(${placeholders.join(', ')})`)
  })

  await pg.pgExecute({
    query: `INSERT INTO requests (${columns.join(', ')}) VALUES ${values.join(', ')}`,
    params,
  })
}

/**
 * Records the org's activity watermark, the way logging a real request would.
 *
 * The crons that scan `requests` read this first and skip the scan when an org
 * has nothing newer, so rows seeded without it stay invisible to the very jobs
 * a "recent traffic" fixture exists to feed. It carries the newest row's
 * timestamp, matching what lib/logger.ts writes.
 */
async function recordActivity(newest: Date): Promise<void> {
  await pg.pgExecute({
    query: `
      INSERT INTO org_activity (organization_id, last_request_at, updated_at)
      VALUES ({orgId}, {lastRequestAt}, now())
      ON CONFLICT (organization_id) DO UPDATE
        SET last_request_at = GREATEST(org_activity.last_request_at, EXCLUDED.last_request_at),
            updated_at      = now()
    `,
    params: { orgId: ORG_ID, lastRequestAt: newest.toISOString() },
  })
}

async function seedRequests(): Promise<number> {
  console.log('Seeding last-24h requests...')
  const rows: Record<string, unknown>[] = []
  let oldest = new Date()
  let newest = new Date(0)

  for (let hoursAgo = 0; hoursAgo < 24; hoursAgo++) {
    const count = volumeForHoursAgo(hoursAgo)
    for (let i = 0; i < count; i++) {
      const pd = pick(PROVIDERS)
      const model = pick(pd.models)
      const promptTok = rand(120, 2400)
      const completionTok = rand(60, 900)
      const price = PRICES[model] ?? { inp: 0.000002, out: 0.000008 }
      const isError = Math.random() < 0.045
      const hasUser = Math.random() < 0.75
      // Spread each hour's requests across its 60 minutes.
      const ts = new Date(
        Date.now() - hoursAgo * 3_600_000 - rand(0, 59) * 60_000 - rand(0, 59) * 1000,
      )
      if (ts < oldest) oldest = ts
      if (ts > newest) newest = ts

      rows.push({
        id: uuid(),
        organization_id: ORG_ID,
        project_id: PROJECT_ID,
        api_key_id: API_KEY_ID,
        provider: pd.provider,
        model,
        prompt_tokens: promptTok,
        completion_tokens: completionTok,
        total_tokens: promptTok + completionTok,
        cache_read_tokens: Math.random() < 0.25 ? rand(50, 800) : 0,
        cache_write_tokens: 0,
        cost_usd: promptTok * price.inp + completionTok * price.out,
        latency_ms: rand(280, 5200),
        proxy_overhead_ms: rand(4, 70),
        status_code: isError ? pick([400, 429, 500, 503]) : 200,
        request_body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: 'You are a helpful assistant.' },
            { role: 'user', content: `Request at T-${hoursAgo}h #${i}` },
          ],
        }),
        response_body: isError
          ? JSON.stringify({ error: { message: 'Rate limit exceeded', type: 'rate_limit_error' } })
          : JSON.stringify({
              id: `chatcmpl-recent${hoursAgo}-${i}`,
              choices: [
                { message: { role: 'assistant', content: 'Response.' }, finish_reason: 'stop' },
              ],
              usage: {
                prompt_tokens: promptTok,
                completion_tokens: completionTok,
                total_tokens: promptTok + completionTok,
              },
            }),
        error_message: isError ? 'Rate limit exceeded' : null,
        trace_id: null,
        span_id: null,
        prompt_version_id: null,
        provider_key_id: null,
        user_id: hasUser ? pick(USERS) : null,
        session_id: hasUser ? pick(SESSIONS) : null,
        // Both flag columns are JSON-encoded ARRAYS of SecurityFlag. Writing
        // `{}` here makes the security page throw `resFlags.map is not a
        // function` as soon as a row is surfaced.
        flags: '[]',
        response_flags: '[]',
        has_security_flags: false,
        truncated: false,
        cache_hit: false,
        service_tier: '',
        created_at: ts.toISOString(),
      })
    }
  }

  await ensurePartitionsFor(oldest)

  for (let i = 0; i < rows.length; i += BATCH_ROWS) {
    await insertRequestBatch(rows.slice(i, i + BATCH_ROWS))
    process.stdout.write(`  ${Math.min(i + BATCH_ROWS, rows.length)}/${rows.length}\r`)
  }
  await recordActivity(newest)

  console.log(`\n  Inserted ${rows.length} requests across the last 24h`)
  return rows.length
}

async function seedTraces(): Promise<number> {
  console.log('Seeding last-24h traces...')
  const scenarios = [
    {
      name: 'customer-support-agent',
      spans: ['intent-parse', 'kb-retrieval', 'llm-respond', 'quality-check'],
    },
    { name: 'rag-pipeline', spans: ['embed-query', 'vector-search', 'rerank', 'llm-answer'] },
    {
      name: 'multi-step-reasoning',
      spans: ['decompose', 'search-step-1', 'search-step-2', 'synthesize'],
    },
    { name: 'document-summarizer', spans: ['chunk-split', 'map-summarize', 'reduce-combine'] },
  ]

  let traceCount = 0
  for (const scenario of scenarios) {
    for (let inst = 0; inst < 4; inst++) {
      const traceId = uuid()
      const isError = Math.random() < 0.2
      const startTime = new Date(Date.now() - rand(5, 23 * 60) * 60_000)

      let offset = 0
      let totalMs = 0
      let totalTokens = 0
      let totalCost = 0
      const spanRows: Record<string, unknown>[] = []
      let parentSpanId: string | null = null

      for (let si = 0; si < scenario.spans.length; si++) {
        const spanId = uuid()
        const dur = rand(80, 1600)
        const ptok = rand(60, 700)
        const ctok = rand(30, 350)
        const cost = ptok * 0.000002 + ctok * 0.000008
        const failsHere = isError && si === scenario.spans.length - 1

        offset += si > 0 ? rand(10, 45) : 0
        totalMs += dur
        totalTokens += ptok + ctok
        totalCost += cost

        spanRows.push({
          id: spanId,
          trace_id: traceId,
          parent_span_id: si === 0 ? null : parentSpanId,
          organization_id: ORG_ID,
          name: scenario.spans[si],
          span_type: pick(['llm', 'tool', 'retrieval', 'embedding']),
          status: failsHere ? 'error' : 'completed',
          started_at: new Date(startTime.getTime() + offset).toISOString(),
          ended_at: new Date(startTime.getTime() + offset + dur).toISOString(),
          duration_ms: dur,
          input: { step: si, query: `Input for ${scenario.spans[si]}` },
          output: failsHere ? null : { result: 'ok', tokens: ptok + ctok },
          metadata: { step_index: si },
          error_message: failsHere ? 'Upstream timeout' : null,
          request_id: null,
          prompt_tokens: ptok,
          completion_tokens: ctok,
          total_tokens: ptok + ctok,
          cost_usd: cost.toFixed(8),
          created_at: startTime.toISOString(),
        })

        if (si === 0) parentSpanId = spanId
        offset += dur
      }

      const { error: traceErr } = await sb.from('traces').insert({
        id: traceId,
        organization_id: ORG_ID,
        project_id: PROJECT_ID,
        api_key_id: API_KEY_ID,
        name: scenario.name,
        status: isError ? 'error' : 'completed',
        started_at: startTime.toISOString(),
        ended_at: new Date(startTime.getTime() + totalMs).toISOString(),
        duration_ms: totalMs,
        metadata: { scenario: scenario.name, instance: inst },
        error_message: isError ? 'Agent step failed' : null,
        span_count: spanRows.length,
        total_tokens: totalTokens,
        total_cost_usd: totalCost.toFixed(8),
        created_at: startTime.toISOString(),
        updated_at: startTime.toISOString(),
      })
      if (traceErr) {
        console.warn(`  trace warn: ${traceErr.message}`)
        continue
      }

      const { error: spanErr } = await sb.from('spans').insert(spanRows)
      if (spanErr) console.warn(`  span warn: ${spanErr.message}`)
      traceCount++
    }
  }
  console.log(`  Created ${traceCount} traces in the last 24h`)
  return traceCount
}

async function main() {
  console.log('=== Seeding recent (last 24h) traffic ===\n')
  pg = await import('../apps/server/src/lib/postgres.js')
  try {
    const requests = await seedRequests()
    const traces = await seedTraces()
    console.log('\nDone.')
    console.log(`  ${requests} requests, ${traces} traces added to the last 24 hours`)
  } finally {
    // Pooled connections hold the event loop open, so the process hangs after
    // its work is done unless the pool is closed on both paths.
    await pg.resetPostgresPool()
  }
}

main().catch((err) => {
  console.error('\nFailed:', err)
  process.exit(1)
})
