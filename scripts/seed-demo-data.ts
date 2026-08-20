/**
 * Seed demo data for demo@spanlens.io
 * Run: pnpm --filter server exec tsx ../../scripts/seed-demo-data.ts
 */

import { createClient } from '@supabase/supabase-js'
import crypto from 'node:crypto'

/**
 * The `requests` writer. Imported dynamically from main() so the connection
 * string below is in place before the module reads it.
 */
type Postgres = typeof import('../apps/server/src/lib/postgres.js')

// ─── Config ─────────────────────────────────────────────────────────────────
// Target workspace. Override per-environment via env vars so the script is not
// pinned to one seeded org: SEED_ORG_ID / SEED_PROJECT_ID / SEED_API_KEY_ID /
// SEED_USER_ID. Defaults point at the local demo@spanlens.io workspace.
function required(name: string, fallback: string): string {
  const value = process.env[name]?.trim()
  return value && value.length > 0 ? value : fallback
}

const ORG_ID = required('SEED_ORG_ID', '5d98e450-b0a8-4361-bc8e-c30be1992983')
const PROJECT_ID = required('SEED_PROJECT_ID', 'f00e80cf-6d94-4281-98ba-e731063463fb')
const API_KEY_ID = required('SEED_API_KEY_ID', 'fed8bdde-b4b2-4646-a9a3-74d1ea44d3ac')
const USER_ID = required('SEED_USER_ID', '0ee3a733-5d80-47df-b708-106416b00f82')

const sb = createClient(
  required('SUPABASE_URL', 'http://127.0.0.1:54321'),
  required(
    'SUPABASE_SERVICE_ROLE_KEY',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU',
  ),
)
// lib/postgres.ts throws rather than guessing when this is missing, so give it
// the local stack's pooler port alongside the other local defaults above.
process.env['SUPABASE_DB_POOLER_URL'] = required(
  'SUPABASE_DB_POOLER_URL',
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
)

// ─── Helpers ─────────────────────────────────────────────────────────────────
const uuid = () => crypto.randomUUID()
const rand = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min
// crypto.randomInt rather than Math.random: `pick` also chooses the seeded
// user_id / session_id values, and CodeQL (js/insecure-randomness) treats any
// Math.random feeding an identifier as a finding. Seed data doesn't need
// unpredictability, but a CSPRNG costs nothing here and keeps the scan clean.
const pick = <T>(arr: T[]): T => arr[crypto.randomInt(arr.length)]
const daysAgo = (n: number): Date => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(rand(0, 23))
  d.setMinutes(rand(0, 59))
  d.setSeconds(rand(0, 59))
  return d
}

async function insert<T extends Record<string, unknown>>(
  table: string,
  rows: T | T[],
  opts: { onConflict?: string } = {},
) {
  const arr = Array.isArray(rows) ? rows : [rows]
  const q = opts.onConflict
    ? sb.from(table).upsert(arr as never, { onConflict: opts.onConflict, ignoreDuplicates: true })
    : sb.from(table).insert(arr as never)
  const { error } = await q
  if (error) throw new Error(`Insert into ${table} failed: ${error.message}`)
}

// ─── Reference data ──────────────────────────────────────────────────────────
const PROVIDERS = [
  {
    provider: 'openai',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4o-mini-2024-07-18', 'o1-mini', 'gpt-3.5-turbo'],
  },
  {
    provider: 'anthropic',
    models: ['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
  },
  { provider: 'gemini', models: ['gemini-2.5-pro', 'gemini-2.0-flash'] },
]
const USERS = ['user_alice', 'user_bob', 'user_carol', 'user_dave', 'user_eve', 'user_frank']
const SESSIONS = Array.from({ length: 15 }, (_, i) => `sess_${String(i + 1).padStart(3, '0')}`)
const PRICE_MAP: Record<string, { inp: number; out: number }> = {
  'gpt-4o': { inp: 0.0000025, out: 0.00001 },
  'gpt-4o-mini': { inp: 0.00000015, out: 0.0000006 },
  'gpt-4o-mini-2024-07-18': { inp: 0.00000015, out: 0.0000006 },
  'o1-mini': { inp: 0.000003, out: 0.000012 },
  'gpt-3.5-turbo': { inp: 0.0000005, out: 0.0000015 },
  'claude-opus-4-8': { inp: 0.000015, out: 0.000075 },
  'claude-sonnet-4-6': { inp: 0.000003, out: 0.000015 },
  'claude-haiku-4-5-20251001': { inp: 0.00000025, out: 0.00000125 },
  'gemini-2.5-pro': { inp: 0.00000125, out: 0.00001 },
  'gemini-2.0-flash': { inp: 0.0000001, out: 0.0000004 },
}

// ─── 1. Prompt versions ───────────────────────────────────────────────────────
async function seedPrompts(): Promise<string[]> {
  console.log('Seeding prompt versions...')
  const defs = [
    {
      name: 'customer-support',
      versions: [
        { v: 1, content: 'You are a helpful customer support agent. Answer concisely.' },
        { v: 2, content: 'You are a friendly support specialist. Resolve issues empathetically.' },
        { v: 3, content: 'You are an expert support agent. Always offer clear next steps.' },
      ],
    },
    {
      name: 'code-review',
      versions: [
        { v: 1, content: 'Review this code for bugs, style, and performance.' },
        {
          v: 2,
          content:
            'You are a senior engineer. Review for correctness, security, and maintainability.',
        },
      ],
    },
    {
      name: 'rag-assistant',
      versions: [
        { v: 1, content: 'Answer using only the provided context. If unsure, say so.' },
        {
          v: 2,
          content: 'Using the retrieved context, answer accurately. Cite sources when possible.',
        },
      ],
    },
  ]

  const ids: string[] = []
  for (const prompt of defs) {
    for (const v of prompt.versions) {
      const id = uuid()
      ids.push(id)
      await insert(
        'prompt_versions',
        {
          id,
          organization_id: ORG_ID,
          project_id: PROJECT_ID,
          name: prompt.name,
          version: v.v,
          content: v.content,
          variables: {},
          metadata: {},
          created_by: USER_ID,
          created_at: daysAgo(rand(5, 30)).toISOString(),
          is_archived: false,
        },
        { onConflict: 'organization_id,name,version' },
      )
    }
  }
  console.log(`  Created ${ids.length} prompt versions`)
  return ids
}

// ─── 2. Requests ──────────────────────────────────────────────────────────────
/** How far back the generated traffic reaches. */
const REQUEST_DAYS = 30

/** Rows per INSERT. Keeps bound parameters per statement in the low thousands. */
const REQUEST_BATCH = 100

/**
 * Columns of `requests`, in the order the INSERT binds them. Mirrors
 * REQUEST_COLUMNS in apps/server/src/lib/logger.ts, because a seeded row
 * should be indistinguishable from one the proxy wrote.
 */
const REQUEST_COLUMNS = [
  'id',
  'organization_id',
  'project_id',
  'api_key_id',
  'provider',
  'model',
  'prompt_tokens',
  'completion_tokens',
  'total_tokens',
  'cache_read_tokens',
  'cache_write_tokens',
  'cost_usd',
  'latency_ms',
  'proxy_overhead_ms',
  'status_code',
  'request_body',
  'response_body',
  'error_message',
  'trace_id',
  'span_id',
  'prompt_version_id',
  'provider_key_id',
  'user_id',
  'session_id',
  'flags',
  'response_flags',
  'has_security_flags',
  'truncated',
  'cache_hit',
  'service_tier',
  'created_at',
] as const

/** Columns holding JSON text, which needs an explicit cast on the placeholder. */
const JSONB_COLUMNS = new Set<string>(['flags', 'response_flags'])

/** Spelled out so a forgotten column is a compile error rather than a failed run. */
type RequestRow = Record<(typeof REQUEST_COLUMNS)[number], unknown> & { created_at: string }

/**
 * Creates the monthly partitions the backdated rows need.
 *
 * Backdating REQUEST_DAYS days reaches into the previous month for most of the
 * calendar, and a row whose month has no partition lands in
 * `requests_default`. That is not something to tidy up afterwards: creating
 * the real partition for that range then fails until the rows are moved, and
 * the attempt takes ACCESS EXCLUSIVE on the parent, which parks proxy writes
 * behind it. See apps/server/src/lib/cron-jobs/maintain-request-partitions.ts.
 *
 * The months-back argument is rounded up from REQUEST_DAYS rather than fixed,
 * so widening the seed window cannot silently outrun the partitions.
 */
async function ensureSeedPartitions(pg: Postgres): Promise<void> {
  const monthsBack = Math.ceil(REQUEST_DAYS / 28) + 1
  await pg.pgExecute({
    query: 'SELECT * FROM ensure_requests_partitions({ahead}, {back})',
    params: { ahead: 3, back: monthsBack },
  })
}

/** One multi-row INSERT. Every value is bound; nothing is interpolated. */
async function insertRequestRows(pg: Postgres, rows: RequestRow[]): Promise<void> {
  const params: Record<string, unknown> = {}
  const tuples = rows.map((row, i) => {
    const placeholders = REQUEST_COLUMNS.map((col) => {
      const name = `r${i}_${col}`
      params[name] = row[col]
      return JSONB_COLUMNS.has(col) ? `{${name}}::jsonb` : `{${name}}`
    })
    return `(${placeholders.join(', ')})`
  })

  await pg.pgExecute({
    query: `INSERT INTO requests (${REQUEST_COLUMNS.join(', ')}) VALUES ${tuples.join(', ')}`,
    params,
  })
}

async function seedRequests(pg: Postgres, promptVersionIds: string[]) {
  console.log('Seeding requests...')

  // SecurityFlag objects, not bare strings: the dashboard renders f.type and
  // f.pattern per badge, so a plain string array renders empty badges.
  const securityFlags = [
    '[{"type":"injection","pattern":"ignore-previous","sample":"***ignore all previous instructions***"}]',
    '[{"type":"pii","pattern":"email","sample":"te*****@e*****.com"}]',
    '[{"type":"injection","pattern":"jailbreak","sample":"***pretend you have no rules***"}]',
    '[{"type":"injection","pattern":"ignore-previous","sample":"***disregard the system prompt***"},{"type":"pii","pattern":"phone","sample":"+82-10-***-1234"}]',
  ]

  const rows: RequestRow[] = []

  for (let day = 0; day < REQUEST_DAYS; day++) {
    // Organic growth: fewer requests older days, more recent
    const count = Math.max(10, Math.floor(12 + day * 1.8 + rand(-3, 5)))

    for (let i = 0; i < count; i++) {
      const pd = pick(PROVIDERS)
      const model = pick(pd.models)
      const provider = pd.provider
      const promptTok = rand(80, 2000)
      const completionTok = rand(40, 800)
      const prices = PRICE_MAP[model] ?? { inp: 0.000002, out: 0.000008 }
      const costUsd = promptTok * prices.inp + completionTok * prices.out
      const isError = Math.random() < 0.05
      const hasUser = Math.random() < 0.65
      const hasPromptVer = promptVersionIds.length > 0 && Math.random() < 0.45
      const hasFlags = Math.random() < 0.03

      rows.push({
        id: uuid(),
        organization_id: ORG_ID,
        project_id: PROJECT_ID,
        api_key_id: API_KEY_ID,
        provider,
        model,
        prompt_tokens: promptTok,
        completion_tokens: completionTok,
        total_tokens: promptTok + completionTok,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        // Fixed scale rather than a raw float: the column is numeric(18, 8),
        // and a value near 1e-7 would otherwise arrive in exponent form.
        cost_usd: costUsd.toFixed(8),
        latency_ms: rand(250, 4800),
        proxy_overhead_ms: rand(5, 90),
        status_code: isError ? pick([400, 429, 500, 503]) : 200,
        request_body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: 'You are a helpful assistant.' },
            { role: 'user', content: `Query #${i} on day -${REQUEST_DAYS - day}` },
          ],
        }),
        response_body: isError
          ? JSON.stringify({ error: { message: 'Rate limit exceeded', type: 'rate_limit_error' } })
          : JSON.stringify({
              id: `chatcmpl-demo${i}`,
              choices: [
                {
                  message: { role: 'assistant', content: 'Demo response.' },
                  finish_reason: 'stop',
                },
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
        prompt_version_id: hasPromptVer ? pick(promptVersionIds) : null,
        provider_key_id: null,
        user_id: hasUser ? pick(USERS) : null,
        session_id: hasUser ? pick(SESSIONS) : null,
        // Both flag columns are JSON-encoded ARRAYS of SecurityFlag. Writing
        // `{}` here makes the security page throw `resFlags.map is not a
        // function` for any row with has_security_flags set, and the
        // requests_flags_is_array CHECK now rejects the row outright.
        flags: hasFlags ? pick(securityFlags) : '[]',
        response_flags: '[]',
        has_security_flags: hasFlags,
        truncated: false,
        cache_hit: false,
        service_tier: '',
        created_at: daysAgo(REQUEST_DAYS - day).toISOString(),
      })
    }
  }

  await ensureSeedPartitions(pg)

  for (let i = 0; i < rows.length; i += REQUEST_BATCH) {
    await insertRequestRows(pg, rows.slice(i, i + REQUEST_BATCH))
    process.stdout.write(`  ${Math.min(i + REQUEST_BATCH, rows.length)}/${rows.length} requests\r`)
  }
  console.log(`\n  Inserted ${rows.length} requests`)

  // Logging a request writes two things, not one: the row, and the org's
  // activity watermark. The cron jobs that aggregate this table read the
  // watermark first and skip their scan when an org has nothing new, so a
  // demo workspace seeded with rows alone would leave anomaly detection and
  // the digests correctly concluding there was nothing to look at.
  //
  // It carries the newest seeded row's timestamp, matching what the logger
  // records, so the backdated rows stay invisible to a short-window scan
  // exactly as real old traffic would.
  const newest = rows.reduce(
    (max, row) => (row.created_at > max ? row.created_at : max),
    rows[0]!.created_at,
  )
  await pg.pgExecute({
    query: `
      INSERT INTO org_activity (organization_id, last_request_at, updated_at)
      VALUES ({orgId}, {lastRequestAt}, now())
      ON CONFLICT (organization_id) DO UPDATE
        SET last_request_at = GREATEST(org_activity.last_request_at, EXCLUDED.last_request_at),
            updated_at      = now()
    `,
    params: { orgId: ORG_ID, lastRequestAt: newest },
  })
}

// ─── 3. Traces + Spans ────────────────────────────────────────────────────────
async function seedTraces() {
  console.log('Seeding traces + spans...')

  const scenarios = [
    {
      name: 'customer-support-agent',
      spans: ['intent-parse', 'kb-retrieval', 'llm-respond', 'quality-check'],
    },
    { name: 'rag-pipeline', spans: ['embed-query', 'vector-search', 'rerank', 'llm-answer'] },
    {
      name: 'code-review-agent',
      spans: ['parse-diff', 'security-scan', 'style-lint', 'summary-gen'],
    },
    { name: 'document-summarizer', spans: ['chunk-split', 'map-summarize', 'reduce-combine'] },
    {
      name: 'data-extraction',
      spans: ['ocr-preprocess', 'llm-extract', 'schema-validate', 'post-process'],
    },
    {
      name: 'multi-step-reasoning',
      spans: ['decompose', 'search-step-1', 'search-step-2', 'synthesize'],
    },
    { name: 'content-moderation', spans: ['text-classify', 'policy-eval', 'action-dispatch'] },
    {
      name: 'email-drafter',
      spans: ['context-fetch', 'tone-analysis', 'draft-gen', 'grammar-check'],
    },
    { name: 'api-orchestrator', spans: ['auth-check', 'upstream-call', 'transform-response'] },
    {
      name: 'onboarding-assistant',
      spans: ['profile-load', 'recommendation-gen', 'personalize', 'send-msg'],
    },
  ]

  let tc = 0,
    sc = 0
  for (const scenario of scenarios) {
    for (let inst = 0; inst < 3; inst++) {
      const traceId = uuid()
      const traceStatus = Math.random() < 0.12 ? 'error' : 'completed'
      const startTime = daysAgo(rand(0, 14))

      let offset = 0
      let totalDurationMs = 0
      let totalTokens = 0
      let totalCost = 0
      const spanRows = []

      let parentSpanId: string | null = null

      for (let si = 0; si < scenario.spans.length; si++) {
        const spanId = uuid()
        const dur = rand(60, 1400)
        const ptok = rand(50, 600)
        const ctok = rand(20, 300)
        const cost = ptok * 0.000002 + ctok * 0.000008
        const isLastError = si === scenario.spans.length - 1 && traceStatus === 'error'

        offset += si > 0 ? rand(10, 50) : 0
        totalDurationMs += dur
        totalTokens += ptok + ctok
        totalCost += cost

        spanRows.push({
          id: spanId,
          trace_id: traceId,
          parent_span_id: si === 0 ? null : parentSpanId,
          organization_id: ORG_ID,
          name: scenario.spans[si],
          span_type: pick(['llm', 'tool', 'retrieval', 'embedding', 'custom']),
          status: isLastError ? 'error' : 'completed',
          started_at: new Date(startTime.getTime() + offset).toISOString(),
          ended_at: new Date(startTime.getTime() + offset + dur).toISOString(),
          duration_ms: dur,
          input: { step: si, query: `Input for ${scenario.spans[si]}` },
          output: isLastError ? null : { result: 'ok', tokens: ptok + ctok },
          metadata: { step_index: si },
          error_message: isLastError ? 'Upstream timeout after 1400ms' : null,
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

      const { error: te } = await sb.from('traces').insert({
        id: traceId,
        organization_id: ORG_ID,
        project_id: PROJECT_ID,
        api_key_id: API_KEY_ID,
        name: scenario.name,
        status: traceStatus,
        started_at: startTime.toISOString(),
        ended_at: new Date(startTime.getTime() + totalDurationMs).toISOString(),
        duration_ms: totalDurationMs,
        metadata: { scenario: scenario.name, instance: inst },
        error_message: traceStatus === 'error' ? 'Agent step failed' : null,
        span_count: spanRows.length,
        total_tokens: totalTokens,
        total_cost_usd: totalCost.toFixed(8),
        created_at: startTime.toISOString(),
        updated_at: startTime.toISOString(),
      })
      if (te) {
        console.warn(`  trace warn: ${te.message}`)
        continue
      }

      const { error: se } = await sb.from('spans').insert(spanRows)
      if (se) console.warn(`  span warn: ${se.message}`)

      tc++
      sc += spanRows.length
    }
  }
  console.log(`  Created ${tc} traces, ${sc} spans`)
}

// ─── 4. Notification channels + alerts ───────────────────────────────────────
async function seedAlerts(): Promise<string> {
  console.log('Seeding notification channels + alerts...')

  const emailChId = uuid()
  await insert('notification_channels', {
    id: emailChId,
    organization_id: ORG_ID,
    kind: 'email',
    target: 'demo@spanlens.io',
    label: 'Demo Email',
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  })

  const slackChId = uuid()
  await insert('notification_channels', {
    id: slackChId,
    organization_id: ORG_ID,
    kind: 'slack',
    target: 'https://hooks.slack.com/services/demo/placeholder',
    label: '#llm-alerts',
    is_active: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  })

  const alertDefs = [
    {
      name: 'Monthly budget $50',
      type: 'budget',
      threshold: 50,
      window_minutes: 43200,
      cooldown_minutes: 1440,
    },
    {
      name: 'Error rate > 5%',
      type: 'error_rate',
      threshold: 0.05,
      window_minutes: 60,
      cooldown_minutes: 60,
    },
    {
      name: 'P95 latency > 3s',
      type: 'latency_p95',
      threshold: 3000,
      window_minutes: 60,
      cooldown_minutes: 120,
    },
    {
      name: 'Weekly budget $10',
      type: 'budget',
      threshold: 10,
      window_minutes: 10080,
      cooldown_minutes: 720,
    },
  ]

  for (const def of alertDefs) {
    await insert('alerts', {
      id: uuid(),
      organization_id: ORG_ID,
      project_id: PROJECT_ID,
      name: def.name,
      type: def.type,
      threshold: def.threshold,
      window_minutes: def.window_minutes,
      is_active: true,
      cooldown_minutes: def.cooldown_minutes,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
  }

  console.log('  Created 2 channels, 4 alerts')
  return emailChId
}

// ─── 5. Anomaly events ────────────────────────────────────────────────────────
async function seedAnomalyEvents() {
  console.log('Seeding anomaly events...')

  const anomalies = [
    {
      provider: 'openai',
      model: 'gpt-4o',
      kind: 'latency',
      current: 3850,
      mean: 1200,
      stddev: 280,
    },
    {
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      kind: 'cost',
      current: 0.12,
      mean: 0.04,
      stddev: 0.01,
    },
    {
      provider: 'openai',
      model: 'gpt-4o-mini',
      kind: 'error_rate',
      current: 0.08,
      mean: 0.02,
      stddev: 0.008,
    },
    {
      provider: 'gemini',
      model: 'gemini-2.5-pro',
      kind: 'latency',
      current: 2800,
      mean: 900,
      stddev: 200,
    },
  ]

  let count = 0
  for (let day = 0; day < 14; day++) {
    for (const a of anomalies) {
      if (Math.random() < 0.4) continue
      const detectedAt = daysAgo(day)
      const deviations = (a.current - a.mean) / a.stddev
      await insert(
        'anomaly_events',
        {
          id: uuid(),
          organization_id: ORG_ID,
          detected_on: detectedAt.toISOString().slice(0, 10),
          provider: a.provider,
          model: a.model,
          kind: a.kind,
          current_value: a.current * (0.9 + Math.random() * 0.2),
          baseline_mean: a.mean,
          baseline_stddev: a.stddev,
          deviations: parseFloat(deviations.toFixed(2)),
          sample_count: rand(50, 300),
          reference_count: rand(500, 3000),
          detected_at: detectedAt.toISOString(),
          confidence: deviations > 4 ? 'high' : deviations > 3 ? 'medium' : 'low',
        },
        { onConflict: 'organization_id,detected_on,provider,model,kind' },
      )
      count++
    }
  }
  console.log(`  Created ${count} anomaly events`)
}

// ─── 6. Provider key ──────────────────────────────────────────────────────────
async function seedProviderKey() {
  console.log('Seeding provider key...')
  const { data: existing } = await sb
    .from('provider_keys')
    .select('id')
    .eq('api_key_id', API_KEY_ID)
    .eq('provider', 'openai')
    .eq('is_active', true)
    .maybeSingle()
  if (existing) {
    console.log('  Provider key already exists, skipping')
    return
  }

  await insert('provider_keys', {
    id: uuid(),
    organization_id: ORG_ID,
    api_key_id: API_KEY_ID,
    provider: 'openai',
    name: 'Demo OpenAI Key',
    encrypted_key: 'demo-encrypted-placeholder-not-usable',
    is_active: true,
    provider_metadata: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  })
  console.log('  Created 1 provider key')
}

// ─── 7. Webhook ───────────────────────────────────────────────────────────────
async function seedWebhook() {
  console.log('Seeding webhook...')
  await insert('webhooks', {
    id: uuid(),
    organization_id: ORG_ID,
    name: 'Demo Webhook',
    url: 'https://example.com/webhook/demo',
    secret: crypto.randomBytes(20).toString('hex'),
    events: ['request.completed', 'anomaly.detected', 'alert.triggered'],
    is_active: true,
    created_at: new Date().toISOString(),
  })
  console.log('  Created 1 webhook')
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== Seeding demo@spanlens.io ===\n')
  // Imported here rather than at the top so the connection string set above is
  // already in place, and so the pool is only opened when the script runs.
  const pg: Postgres = await import('../apps/server/src/lib/postgres.js')
  try {
    const pvIds = await seedPrompts()
    await seedRequests(pg, pvIds)
    await seedTraces()
    await seedAlerts()
    await seedAnomalyEvents()
    await seedProviderKey()
    await seedWebhook()

    console.log('\n✓ Done!')
    console.log('─────────────────────────────')
    console.log('  Account:  demo@spanlens.io')
    console.log('  Password: Demo1234!')
    console.log('  URL:      http://localhost:3000')
    console.log('─────────────────────────────')
  } catch (err) {
    console.error('\nFailed:', err)
    process.exit(1)
  } finally {
    // Idle pool clients keep the event loop alive, so the script would hang
    // after printing its summary.
    await pg.resetPostgresPool()
  }
}

main()
