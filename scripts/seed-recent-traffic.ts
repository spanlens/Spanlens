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
import { createClient as createClickHouseClient } from '@clickhouse/client'
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
const ch = createClickHouseClient({
  url: required('CLICKHOUSE_URL', 'http://localhost:8123'),
  username: required('CLICKHOUSE_USER', 'spanlens'),
  password: required('CLICKHOUSE_PASSWORD', 'spanlens'),
  database: required('CLICKHOUSE_DB', 'spanlens'),
})

const uuid = () => crypto.randomUUID()
const rand = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min
const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]!
// ClickHouse DateTime64 rejects the ISO `T` separator and `Z` suffix.
const toChTs = (d: Date) => d.toISOString().replace('T', ' ').replace('Z', '').slice(0, 23)

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

async function seedRequests(): Promise<number> {
  console.log('Seeding last-24h requests...')
  const rows: Record<string, unknown>[] = []

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
        created_at: toChTs(ts),
        truncated: 0,
        service_tier: '',
      })
    }
  }

  for (let i = 0; i < rows.length; i += 200) {
    await ch.insert({ table: 'requests', values: rows.slice(i, i + 200), format: 'JSONEachRow' })
    process.stdout.write(`  ${Math.min(i + 200, rows.length)}/${rows.length}\r`)
  }
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
  try {
    const requests = await seedRequests()
    const traces = await seedTraces()
    console.log('\nDone.')
    console.log(`  ${requests} requests, ${traces} traces added to the last 24 hours`)
  } catch (err) {
    console.error('\nFailed:', err)
    process.exit(1)
  }
}

main()
