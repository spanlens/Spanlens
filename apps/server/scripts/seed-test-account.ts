/**
 * Seeds a local test account with dummy dashboard data.
 *
 * Creates: 1 auth user, 1 organization, 2 projects, ~6 agent traces with
 * 30+ spans, ~120 LLM requests in ClickHouse spread across the last 7 days.
 *
 * Intentionally does NOT create Spanlens (sl_live_*) API keys or provider
 * keys — per the seed request, the account starts "clean" so the user can
 * issue their own keys through the UI.
 *
 * Run:
 *   pnpm --filter server tsx scripts/seed-test-account.ts
 *
 * Idempotent: re-runs delete the previous test org+user first.
 */
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

// ── Config ────────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env['SUPABASE_URL'] ?? 'http://127.0.0.1:54321'
const SUPABASE_SERVICE_ROLE_KEY =
  process.env['SUPABASE_SERVICE_ROLE_KEY'] ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
const CLICKHOUSE_URL = process.env['CLICKHOUSE_URL'] ?? 'http://localhost:8123'
const CLICKHOUSE_USER = process.env['CLICKHOUSE_USER'] ?? 'spanlens'
const CLICKHOUSE_PASSWORD = process.env['CLICKHOUSE_PASSWORD'] ?? 'spanlens'
const CLICKHOUSE_DB = process.env['CLICKHOUSE_DB'] ?? 'spanlens'

const TEST_EMAIL = 'testuser@spanlens.local'
const TEST_PASSWORD = 'TestPass123!'
const TEST_FULL_NAME = 'Test User'
const TEST_ORG_NAME = 'Smoke Test Workspace'

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// ── Utility ───────────────────────────────────────────────────────────────────
function ts(date: Date): string {
  // ClickHouse DateTime64 doesn't accept the trailing 'Z' from .toISOString()
  // (see CLAUDE.md gotcha #18). 'T' → ' ' too.
  return date.toISOString().replace('T', ' ').replace('Z', '')
}

function pick<T>(arr: readonly T[], i: number): T {
  return arr[i % arr.length] as T
}

// Deterministic-but-varied RNG seeded on the index so each row varies but
// re-running the script lands the same shape.
function jitter(i: number, scale: number): number {
  const x = Math.sin(i * 9301 + 49297) * 233280
  return ((x - Math.floor(x)) - 0.5) * 2 * scale
}

async function ch(query: string, body?: string): Promise<void> {
  const url = `${CLICKHOUSE_URL}/?query=${encodeURIComponent(query)}&database=${CLICKHOUSE_DB}`
  const auth = 'Basic ' + Buffer.from(`${CLICKHOUSE_USER}:${CLICKHOUSE_PASSWORD}`).toString('base64')
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: body ?? '',
  })
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`ClickHouse query failed (${res.status}): ${txt}\nQuery: ${query.slice(0, 200)}`)
  }
}

// ── Cleanup any prior run ─────────────────────────────────────────────────────
async function cleanup(): Promise<void> {
  console.log('🧹 cleaning up any previous test account...')

  // Find existing user by email
  const { data: users } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 })
  const existing = users?.users.find((u) => u.email === TEST_EMAIL)
  if (existing) {
    // Find their orgs first so we can delete dependent ClickHouse rows
    const { data: memberships } = await supabase
      .from('org_members')
      .select('organization_id')
      .eq('user_id', existing.id)
    const orgIds = (memberships ?? []).map((m) => m.organization_id as string)

    if (orgIds.length > 0) {
      // Delete from ClickHouse first (no FK, no cascade — manual)
      const inList = orgIds.map((id) => `'${id}'`).join(',')
      await ch(`ALTER TABLE requests DELETE WHERE organization_id IN (${inList})`)

      // Delete orgs — cascades to projects, org_members, traces, spans via FK
      await supabase.from('organizations').delete().in('id', orgIds)
    }

    // Delete the auth user
    await supabase.auth.admin.deleteUser(existing.id)
    console.log(`   removed user ${existing.id}`)
  } else {
    console.log('   no previous account found')
  }
}

// ── Create user + org + projects ──────────────────────────────────────────────
interface SeedContext {
  userId: string
  orgId: string
  projectIds: { app: string; pipeline: string }
}

async function createAccount(): Promise<SeedContext> {
  console.log('\n👤 creating auth user...')
  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: TEST_FULL_NAME },
  })
  if (createErr || !created.user) {
    throw new Error(`auth.admin.createUser failed: ${createErr?.message ?? 'no user'}`)
  }
  const userId = created.user.id
  console.log(`   user: ${userId}`)

  console.log('\n🏢 creating organization...')
  const orgId = randomUUID()
  const { error: orgErr } = await supabase.from('organizations').insert({
    id: orgId,
    name: TEST_ORG_NAME,
    owner_id: userId,
    plan: 'team',
  })
  if (orgErr) throw new Error(`organizations insert: ${orgErr.message}`)
  console.log(`   org: ${orgId}`)

  console.log('\n👥 attaching user to org...')
  const { error: memberErr } = await supabase.from('org_members').insert({
    organization_id: orgId,
    user_id: userId,
    role: 'admin',
  })
  if (memberErr) throw new Error(`org_members insert: ${memberErr.message}`)

  console.log('\n📁 creating projects...')
  const appProjectId = randomUUID()
  const pipelineProjectId = randomUUID()
  const { error: projErr } = await supabase.from('projects').insert([
    {
      id: appProjectId,
      organization_id: orgId,
      name: 'customer-support-app',
      description: 'Production support chat traffic',
    },
    {
      id: pipelineProjectId,
      organization_id: orgId,
      name: 'analytics-pipeline',
      description: 'Nightly batch summarisation jobs',
    },
  ])
  if (projErr) throw new Error(`projects insert: ${projErr.message}`)
  console.log(`   2 projects created`)

  // Backfill: there may be an after-onboard trigger that some apps rely on.
  // Mark the user as onboarded so they land directly on /dashboard.
  await supabase
    .from('user_profiles')
    .upsert(
      { user_id: userId, onboarded_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    )

  return { userId, orgId, projectIds: { app: appProjectId, pipeline: pipelineProjectId } }
}

// ── Seed agent traces + spans ─────────────────────────────────────────────────
async function seedTraces(ctx: SeedContext): Promise<void> {
  console.log('\n🕸️  seeding agent traces + spans...')

  const TRACE_TEMPLATES = [
    {
      name: 'customer-support-agent',
      project: ctx.projectIds.app,
      spans: [
        { name: 'classify_intent', type: 'llm', pt: 340, ct: 22, cost: 0.000098, ms: 412 },
        { name: 'retrieve_order_history', type: 'retrieval', pt: 0, ct: 0, cost: null, ms: 268 },
        { name: 'lookup_refund_policy', type: 'tool', pt: 0, ct: 0, cost: null, ms: 170 },
        { name: 'generate_response', type: 'llm', pt: 1840, ct: 312, cost: 0.00212, ms: 1980 },
      ],
    },
    {
      name: 'doc-summariser',
      project: ctx.projectIds.pipeline,
      spans: [
        { name: 'chunk_input', type: 'custom', pt: 0, ct: 0, cost: null, ms: 84 },
        { name: 'embed_chunks', type: 'embedding', pt: 2400, ct: 0, cost: 0.000048, ms: 612 },
        { name: 'summarise_chunks', type: 'llm', pt: 9800, ct: 1240, cost: 0.0124, ms: 4200 },
        { name: 'merge_summaries', type: 'llm', pt: 1400, ct: 380, cost: 0.0029, ms: 1100 },
      ],
    },
    {
      name: 'sql-translator',
      project: ctx.projectIds.app,
      spans: [
        { name: 'parse_question', type: 'llm', pt: 280, ct: 18, cost: 0.000078, ms: 320 },
        { name: 'lookup_schema', type: 'retrieval', pt: 0, ct: 0, cost: null, ms: 92 },
        { name: 'generate_sql', type: 'llm', pt: 1620, ct: 140, cost: 0.0019, ms: 1450 },
        { name: 'execute_query', type: 'tool', pt: 0, ct: 0, cost: null, ms: 380 },
      ],
    },
    {
      name: 'churn-predictor',
      project: ctx.projectIds.pipeline,
      spans: [
        { name: 'load_features', type: 'retrieval', pt: 0, ct: 0, cost: null, ms: 145 },
        { name: 'rank_users', type: 'llm', pt: 5200, ct: 820, cost: 0.0074, ms: 2840 },
      ],
    },
    {
      name: 'rag-search',
      project: ctx.projectIds.app,
      spans: [
        { name: 'expand_query', type: 'llm', pt: 180, ct: 24, cost: 0.000064, ms: 240 },
        { name: 'vector_search', type: 'retrieval', pt: 0, ct: 0, cost: null, ms: 310 },
        { name: 'rerank', type: 'llm', pt: 900, ct: 0, cost: 0.000245, ms: 540 },
        { name: 'synthesize', type: 'llm', pt: 2100, ct: 410, cost: 0.0034, ms: 2100 },
      ],
    },
    {
      name: 'errored-pipeline',
      project: ctx.projectIds.pipeline,
      status: 'error' as const,
      error: 'OpenAI rate limit exceeded',
      spans: [
        { name: 'fetch_input', type: 'tool', pt: 0, ct: 0, cost: null, ms: 410 },
        {
          name: 'call_openai',
          type: 'llm',
          pt: 0,
          ct: 0,
          cost: null,
          ms: 1200,
          status: 'error' as const,
        },
      ],
    },
  ]

  const tracesPayload: Array<Record<string, unknown>> = []
  const spansPayload: Array<Record<string, unknown>> = []

  for (let i = 0; i < TRACE_TEMPLATES.length; i++) {
    const tpl = TRACE_TEMPLATES[i]!
    const traceId = randomUUID()
    const startsAt = new Date(Date.now() - (i + 1) * 90 * 60_000)
    let cursor = startsAt.getTime()
    const totalCost = tpl.spans.reduce((s, sp) => s + (sp.cost ?? 0), 0)
    const totalTokens = tpl.spans.reduce((s, sp) => s + sp.pt + sp.ct, 0)
    const totalMs = tpl.spans.reduce((s, sp) => s + sp.ms, 0)

    tracesPayload.push({
      id: traceId,
      organization_id: ctx.orgId,
      project_id: tpl.project,
      name: tpl.name,
      status: tpl.status ?? 'completed',
      started_at: new Date(cursor).toISOString(),
      ended_at: new Date(cursor + totalMs).toISOString(),
      duration_ms: totalMs,
      span_count: tpl.spans.length,
      total_tokens: totalTokens,
      total_cost_usd: totalCost,
      error_message: tpl.status === 'error' ? tpl.error ?? null : null,
      metadata: { source: 'seed-script', user_id: `u_${i}beta`, session_id: `s_${i}abc` },
    })

    let parentSpanId: string | null = null
    for (let s = 0; s < tpl.spans.length; s++) {
      const sp = tpl.spans[s]!
      const spanId = randomUUID()
      const spanStart = cursor
      const spanEnd = cursor + sp.ms
      spansPayload.push({
        id: spanId,
        trace_id: traceId,
        parent_span_id: s === 0 ? null : parentSpanId,
        organization_id: ctx.orgId,
        name: sp.name,
        span_type: sp.type,
        status: sp.status ?? 'completed',
        started_at: new Date(spanStart).toISOString(),
        ended_at: new Date(spanEnd).toISOString(),
        duration_ms: sp.ms,
        prompt_tokens: sp.pt,
        completion_tokens: sp.ct,
        total_tokens: sp.pt + sp.ct,
        cost_usd: sp.cost,
        error_message: sp.status === 'error' ? 'rate limit' : null,
      })
      if (s === 0) parentSpanId = spanId
      cursor = spanEnd
    }
  }

  const { error: traceErr } = await supabase.from('traces').insert(tracesPayload)
  if (traceErr) throw new Error(`traces insert: ${traceErr.message}`)
  const { error: spanErr } = await supabase.from('spans').insert(spansPayload)
  if (spanErr) throw new Error(`spans insert: ${spanErr.message}`)
  console.log(`   ${tracesPayload.length} traces, ${spansPayload.length} spans`)
}

// ── Seed ClickHouse requests ──────────────────────────────────────────────────
//
// Each model has its own token-shape so Savings recommendations actually fire:
// gpt-4o lives in the gpt-4o-mini envelope (≤500 prompt, ≤150 completion),
// claude-3-5-sonnet lives in the haiku-4.5 envelope (≤800/≤250),
// gemini-1.5-pro lives in the 2.5-flash envelope (≤1000/≤300).
// gpt-4o-mini and claude-haiku stay "already optimal" buckets.
interface ModelSeed {
  provider: string
  model: string
  pricePerK: number
  promptMean: number
  completionMean: number
  samples: number
}

// Cheap-swap candidates (gpt-4o, claude-3-5-sonnet, gemini-1.5-pro) get
// high volume + envelope-ceiling tokens so projected monthly savings clear
// the recommender's default $5/mo threshold.
const MODELS: readonly ModelSeed[] = [
  { provider: 'openai',    model: 'gpt-4o-2024-08-06',            pricePerK: 0.0025,   promptMean: 480,  completionMean: 140, samples: 1000 },
  { provider: 'openai',    model: 'gpt-4o-mini-2024-07-18',       pricePerK: 0.00015,  promptMean: 1100, completionMean: 240, samples: 80   },
  { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022',   pricePerK: 0.003,    promptMean: 780,  completionMean: 240, samples: 800  },
  { provider: 'anthropic', model: 'claude-3-5-haiku-latest',      pricePerK: 0.0008,   promptMean: 480,  completionMean: 140, samples: 80   },
  { provider: 'gemini',    model: 'gemini-1.5-pro',               pricePerK: 0.00125,  promptMean: 980,  completionMean: 290, samples: 1000 },
] as const

async function seedRequests(ctx: SeedContext): Promise<void> {
  const totalCount = MODELS.reduce((s, m) => s + m.samples, 0)
  console.log(`\n📊 seeding ClickHouse requests (~${totalCount} across 7 days)...`)

  const rows: Array<Record<string, unknown>> = []
  const now = Date.now()
  let globalIdx = 0

  for (let mIdx = 0; mIdx < MODELS.length; mIdx++) {
    const m = MODELS[mIdx]!
    for (let s = 0; s < m.samples; s++) {
      const i = globalIdx++
      const projectId = i % 3 === 0 ? ctx.projectIds.pipeline : ctx.projectIds.app
      // 35% in last 24h, 65% spread over days 2~7 so dashboard delta lines have shape.
      const inWindow = s < Math.floor(m.samples * 0.35)
      const ageHours = inWindow ? Math.random() * 24 : 24 + Math.random() * 144
      const createdAt = new Date(now - ageHours * 3600_000)

      const promptT = Math.max(40, Math.round(m.promptMean + jitter(i, m.promptMean * 0.25)))
      const completionT = Math.max(15, Math.round(m.completionMean + jitter(i + 7, m.completionMean * 0.3)))
      const totalT = promptT + completionT
      const costUsd = (totalT / 1000) * m.pricePerK
      const latency = Math.max(120, Math.round(1400 + jitter(i + 13, 900)))
      const isError = i % 19 === 0 // ~5% error rate

      rows.push({
        id: randomUUID(),
        organization_id: ctx.orgId,
        project_id: projectId,
        api_key_id: null,
        provider: m.provider,
        model: m.model,
        prompt_tokens: promptT,
        completion_tokens: completionT,
        total_tokens: totalT,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        cost_usd: isError ? null : Number(costUsd.toFixed(8)),
        latency_ms: latency,
        proxy_overhead_ms: Math.max(5, Math.round(18 + jitter(i + 21, 12))),
        status_code: isError ? 429 : 200,
        request_body: '',
        response_body: '',
        error_message: isError ? 'rate limit exceeded' : null,
        trace_id: null,
        span_id: null,
        prompt_version_id: null,
        provider_key_id: null,
        user_id: `u_${(i % 14) + 1}`,
        session_id: `s_${(i % 28) + 1}`,
        flags: '[]',
        response_flags: '{}',
        has_security_flags: false,
        created_at: ts(createdAt),
      })
    }
  }

  // ClickHouse JSONEachRow — one JSON object per line
  const body = rows.map((r) => JSON.stringify(r)).join('\n')
  await ch('INSERT INTO requests FORMAT JSONEachRow', body)
  console.log(`   ${rows.length} requests inserted`)
}

// ── Seed prompts (versions library) ───────────────────────────────────────────
interface PromptVersionRef {
  id: string
  name: string
  version: number
}

interface SeededPrompts {
  byName: Record<string, PromptVersionRef[]>
}

async function seedPrompts(ctx: SeedContext): Promise<SeededPrompts> {
  console.log('\n📝 seeding prompts (versioned library)...')

  const PROMPT_TEMPLATES = [
    {
      name: 'support-reply',
      project: ctx.projectIds.app,
      versions: [
        { v: 1, content: 'You are a friendly support agent. Reply briefly to this ticket:\n\n{{ticket}}' },
        { v: 2, content: 'You are a helpful support agent. Read the ticket and offer one concrete next step.\n\nTicket:\n{{ticket}}' },
        { v: 3, content: 'You are an expert support agent. Reply in two sentences max. Be empathetic and offer a concrete next step.\n\nTicket:\n{{ticket}}\n\nCustomer tier: {{tier}}' },
      ],
    },
    {
      name: 'intent-classifier',
      project: ctx.projectIds.app,
      versions: [
        { v: 1, content: 'Classify the user message into one of: order_status, refund, technical_issue, other.\n\nMessage: {{message}}' },
        { v: 2, content: 'You are an intent classifier. Output JSON: {"intent": "..."}. Allowed intents: order_status, refund, technical_issue, billing, other.\n\nMessage: {{message}}' },
      ],
    },
    {
      name: 'summarizer',
      project: ctx.projectIds.pipeline,
      versions: [
        { v: 1, content: 'Summarize the following document in 3 bullet points:\n\n{{doc}}' },
        { v: 2, content: 'Summarize the document in 3 bullets. Each bullet ≤ 20 words.\n\n{{doc}}' },
        { v: 3, content: 'Summarize the document in 3 bullets, ≤ 20 words each. End with a one-line takeaway.\n\n{{doc}}' },
        { v: 4, content: 'Summarize as 3 bullets (≤ 20 words). End with takeaway. If the doc has numbers, preserve the most important one.\n\n{{doc}}' },
      ],
    },
    {
      name: 'sql-translator',
      project: ctx.projectIds.app,
      versions: [
        { v: 1, content: 'Translate the question to SQL for our Postgres schema.\n\nSchema:\n{{schema}}\n\nQuestion: {{question}}' },
        { v: 2, content: 'You are a SQL expert. Translate the question to a SINGLE Postgres SELECT statement. Do not modify data.\n\nSchema:\n{{schema}}\n\nQuestion: {{question}}' },
      ],
    },
  ] as const

  const rows: Array<{
    id: string
    organization_id: string
    project_id: string
    name: string
    version: number
    content: string
    variables: unknown
    metadata: unknown
    created_by: string
  }> = []

  const byName: Record<string, PromptVersionRef[]> = {}

  for (const tpl of PROMPT_TEMPLATES) {
    byName[tpl.name] = []
    for (const v of tpl.versions) {
      const id = randomUUID()
      rows.push({
        id,
        organization_id: ctx.orgId,
        project_id: tpl.project,
        name: tpl.name,
        version: v.v,
        content: v.content,
        variables: [],
        metadata: { source: 'seed-script' },
        created_by: ctx.userId,
      })
      byName[tpl.name]!.push({ id, name: tpl.name, version: v.v })
    }
  }

  const { error } = await supabase.from('prompt_versions').insert(rows)
  if (error) throw new Error(`prompt_versions insert: ${error.message}`)
  console.log(`   ${rows.length} prompt versions across ${PROMPT_TEMPLATES.length} prompts`)

  return { byName }
}

// ── Seed datasets + items ─────────────────────────────────────────────────────
interface SeededDatasets {
  supportGoldenId: string
  intentTestId: string
  supportItemIds: string[]
  intentItemIds: string[]
}

async function seedDatasets(ctx: SeedContext): Promise<SeededDatasets> {
  console.log('\n📦 seeding datasets + items...')

  const supportGoldenId = randomUUID()
  const intentTestId = randomUUID()

  const { error: dsErr } = await supabase.from('datasets').insert([
    {
      id: supportGoldenId,
      organization_id: ctx.orgId,
      name: 'support-golden-set',
      description: 'Curated support tickets with verified ideal responses',
      created_by: ctx.userId,
    },
    {
      id: intentTestId,
      organization_id: ctx.orgId,
      name: 'intent-edge-cases',
      description: 'Ambiguous and adversarial intent classification cases',
      created_by: ctx.userId,
    },
  ])
  if (dsErr) throw new Error(`datasets insert: ${dsErr.message}`)

  const supportItems = [
    { ticket: 'My order #4421 has been stuck in "processing" for 3 days', tier: 'pro',  expected: 'I apologize for the delay on order #4421. I am escalating to fulfillment now and will email an update within 2 hours.' },
    { ticket: 'Can I get a refund for the duplicate charge?',              tier: 'free', expected: 'Yes, I can process a refund for the duplicate charge. You should see it within 3 to 5 business days.' },
    { ticket: 'How do I export my data?',                                   tier: 'pro',  expected: 'You can export from Settings → Data → Export. CSV and JSON are supported.' },
    { ticket: 'Login keeps failing with "session expired"',                 tier: 'team', expected: 'That sounds like a cookie issue. Could you try clearing site data and logging in again? If it persists, I will check your account.' },
    { ticket: 'Pricing question: can I upgrade mid-cycle?',                 tier: 'free', expected: 'Yes, upgrades are prorated. You will only pay for the remaining days at the new tier.' },
    { ticket: 'API returning 429 even though I am under the rate limit',    tier: 'team', expected: 'Could you share a request ID or timestamp? Our 429s include the limit window in the response headers, which will help me debug.' },
    { ticket: 'The mobile app crashed when uploading a 500MB file',         tier: 'pro',  expected: 'Our mobile uploads cap at 250MB. Could you try the web client, which supports up to 5GB?' },
    { ticket: 'Lost my 2FA device and cannot log in',                       tier: 'team', expected: 'I can help with recovery. Could you reply from the email on file so I can verify identity?' },
    { ticket: 'How do I invite my team?',                                   tier: 'pro',  expected: 'Go to Settings → Members → Invite. They will get an email link valid for 7 days.' },
    { ticket: 'Need a custom invoice with VAT for EU compliance',           tier: 'team', expected: 'I will generate a VAT invoice. Could you share your company VAT ID and billing address?' },
    { ticket: 'Webhook deliveries are failing silently',                    tier: 'team', expected: 'Could you share the webhook ID? I can pull the delivery log and check for response codes.' },
    { ticket: 'Cancel my subscription before next renewal',                 tier: 'free', expected: 'You can cancel from Settings → Billing → Cancel. Your access continues until the period end.' },
  ]

  const intentItems = [
    { message: 'where is my order',                                        expected: 'order_status' },
    { message: 'this isn\'t what I bought, send it back',                  expected: 'refund' },
    { message: 'the page won\'t load',                                     expected: 'technical_issue' },
    { message: 'I think I was charged twice',                              expected: 'billing' },
    { message: 'do you have a phone number',                               expected: 'other' },
    { message: 'package never arrived',                                    expected: 'order_status' },
    { message: 'cancel and refund please',                                 expected: 'refund' },
    { message: 'app keeps crashing',                                       expected: 'technical_issue' },
    { message: 'why is my invoice in EUR',                                 expected: 'billing' },
    { message: 'just saying hi',                                           expected: 'other' },
  ]

  const itemRows: Array<Record<string, unknown>> = []
  const supportItemIds: string[] = []
  const intentItemIds: string[] = []

  for (const it of supportItems) {
    const id = randomUUID()
    supportItemIds.push(id)
    itemRows.push({
      id,
      dataset_id: supportGoldenId,
      organization_id: ctx.orgId,
      input: { ticket: it.ticket, tier: it.tier },
      expected_output: it.expected,
    })
  }

  for (const it of intentItems) {
    const id = randomUUID()
    intentItemIds.push(id)
    itemRows.push({
      id,
      dataset_id: intentTestId,
      organization_id: ctx.orgId,
      input: { message: it.message },
      expected_output: it.expected,
    })
  }

  const { error: itErr } = await supabase.from('dataset_items').insert(itemRows)
  if (itErr) throw new Error(`dataset_items insert: ${itErr.message}`)

  console.log(`   2 datasets, ${itemRows.length} items total`)

  return { supportGoldenId, intentTestId, supportItemIds, intentItemIds }
}

// ── Seed evaluators + runs + results ──────────────────────────────────────────
async function seedEvals(
  ctx: SeedContext,
  prompts: SeededPrompts,
  datasets: SeededDatasets,
): Promise<void> {
  console.log('\n🧪 seeding evaluators + runs + results...')

  const supportVersions = prompts.byName['support-reply']!
  const intentVersions = prompts.byName['intent-classifier']!
  const summarizerVersions = prompts.byName['summarizer']!

  // 3 evaluators
  const respQualityId = randomUUID()
  const intentAccuracyId = randomUUID()
  const summaryFaithId = randomUUID()

  const { error: evErr } = await supabase.from('evaluators').insert([
    {
      id: respQualityId,
      organization_id: ctx.orgId,
      name: 'response-quality',
      prompt_name: 'support-reply',
      type: 'llm_judge',
      config: {
        judge_provider: 'openai',
        judge_model: 'gpt-4o-mini',
        criterion: 'Response is empathetic and offers a concrete next step. Score 0 to 1.',
        score_scale: '0-1',
      },
      created_by: ctx.userId,
    },
    {
      id: intentAccuracyId,
      organization_id: ctx.orgId,
      name: 'intent-accuracy',
      prompt_name: 'intent-classifier',
      type: 'llm_judge',
      config: {
        judge_provider: 'openai',
        judge_model: 'gpt-4o-mini',
        criterion: 'Output JSON intent matches the expected intent exactly. Score 1 for match, 0 otherwise.',
        score_scale: '0-1',
      },
      created_by: ctx.userId,
    },
    {
      id: summaryFaithId,
      organization_id: ctx.orgId,
      name: 'summary-faithfulness',
      prompt_name: 'summarizer',
      type: 'llm_judge',
      config: {
        judge_provider: 'anthropic',
        judge_model: 'claude-3-5-haiku-latest',
        criterion: 'Summary contains no claims not present in source document. Score 0 to 1.',
        score_scale: '0-1',
      },
      created_by: ctx.userId,
    },
  ])
  if (evErr) throw new Error(`evaluators insert: ${evErr.message}`)

  // Eval runs (one per evaluator, scored against a specific prompt version)
  interface RunSpec {
    id: string
    evaluatorId: string
    promptVersionId: string
    datasetId: string | null
    sampleSize: number
    avgScore: number
    daysAgo: number
  }

  const runs: RunSpec[] = [
    {
      id: randomUUID(),
      evaluatorId: respQualityId,
      promptVersionId: supportVersions[2]!.id, // v3
      datasetId: datasets.supportGoldenId,
      sampleSize: 12,
      avgScore: 0.82,
      daysAgo: 1,
    },
    {
      id: randomUUID(),
      evaluatorId: respQualityId,
      promptVersionId: supportVersions[1]!.id, // v2
      datasetId: datasets.supportGoldenId,
      sampleSize: 12,
      avgScore: 0.71,
      daysAgo: 3,
    },
    {
      id: randomUUID(),
      evaluatorId: intentAccuracyId,
      promptVersionId: intentVersions[1]!.id, // v2
      datasetId: datasets.intentTestId,
      sampleSize: 10,
      avgScore: 0.90,
      daysAgo: 2,
    },
    {
      id: randomUUID(),
      evaluatorId: summaryFaithId,
      promptVersionId: summarizerVersions[3]!.id, // v4
      datasetId: null,
      sampleSize: 18,
      avgScore: 0.77,
      daysAgo: 4,
    },
  ]

  const runRows = runs.map((r) => ({
    id: r.id,
    organization_id: ctx.orgId,
    evaluator_id: r.evaluatorId,
    prompt_version_id: r.promptVersionId,
    dataset_id: r.datasetId,
    sample_size: r.sampleSize,
    scored_count: r.sampleSize,
    avg_score: r.avgScore,
    total_cost_usd: Number((r.sampleSize * 0.00018).toFixed(6)),
    source: r.datasetId ? 'dataset' : 'production',
    status: 'completed',
    started_at: new Date(Date.now() - r.daysAgo * 86_400_000).toISOString(),
    completed_at: new Date(Date.now() - r.daysAgo * 86_400_000 + 90_000).toISOString(),
    created_by: ctx.userId,
  }))

  const { error: runErr } = await supabase.from('eval_runs').insert(runRows)
  if (runErr) throw new Error(`eval_runs insert: ${runErr.message}`)

  // Per-result scores (jittered around avg)
  const resultRows: Array<Record<string, unknown>> = []
  for (const r of runs) {
    for (let i = 0; i < r.sampleSize; i++) {
      const score = Math.max(0, Math.min(1, r.avgScore + jitter(i + r.sampleSize, 0.18)))
      resultRows.push({
        id: randomUUID(),
        organization_id: ctx.orgId,
        eval_run_id: r.id,
        dataset_item_id: null,
        request_id: null,
        score: Number(score.toFixed(3)),
        reasoning: i % 3 === 0 ? 'Reply was empathetic but missed the specific next step.' : 'Met all criteria.',
        judge_tokens: 480 + Math.round(jitter(i, 120)),
        judge_cost_usd: 0.00018,
      })
    }
  }

  const { error: resErr } = await supabase.from('eval_results').insert(resultRows)
  if (resErr) throw new Error(`eval_results insert: ${resErr.message}`)

  console.log(`   3 evaluators, ${runs.length} runs, ${resultRows.length} per-result scores`)
}

// ── Seed experiments + results ────────────────────────────────────────────────
async function seedExperiments(
  ctx: SeedContext,
  prompts: SeededPrompts,
  datasets: SeededDatasets,
): Promise<void> {
  console.log('\n🧬 seeding experiments + results...')

  const supportVersions = prompts.byName['support-reply']!
  const intentVersions = prompts.byName['intent-classifier']!

  // Experiment 1: support v2 vs v3, completed, v3 wins
  const exp1Id = randomUUID()
  // Experiment 2: intent v1 vs v2, running, partial results
  const exp2Id = randomUUID()

  const exp1Total = datasets.supportItemIds.length
  const exp2Total = datasets.intentItemIds.length
  const exp2Completed = Math.floor(exp2Total * 0.6)

  const { error: expErr } = await supabase.from('experiments').insert([
    {
      id: exp1Id,
      organization_id: ctx.orgId,
      name: 'support-v2-vs-v3',
      dataset_id: datasets.supportGoldenId,
      prompt_name: 'support-reply',
      version_a_id: supportVersions[1]!.id, // v2
      version_b_id: supportVersions[2]!.id, // v3
      run_model: 'gpt-4o-mini',
      run_provider: 'openai',
      evaluator_id: null,
      status: 'completed',
      total_items: exp1Total,
      completed_items: exp1Total,
      avg_score_a: 0.71,
      avg_score_b: 0.82,
      total_cost_usd: Number((exp1Total * 2 * 0.00021).toFixed(6)),
      started_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
      completed_at: new Date(Date.now() - 2 * 86_400_000 + 240_000).toISOString(),
      created_by: ctx.userId,
    },
    {
      id: exp2Id,
      organization_id: ctx.orgId,
      name: 'intent-v1-vs-v2',
      dataset_id: datasets.intentTestId,
      prompt_name: 'intent-classifier',
      version_a_id: intentVersions[0]!.id, // v1
      version_b_id: intentVersions[1]!.id, // v2
      run_model: 'gpt-4o-mini',
      run_provider: 'openai',
      evaluator_id: null,
      status: 'running',
      total_items: exp2Total,
      completed_items: exp2Completed,
      avg_score_a: null,
      avg_score_b: null,
      total_cost_usd: Number((exp2Completed * 2 * 0.00009).toFixed(6)),
      started_at: new Date(Date.now() - 25 * 60_000).toISOString(),
      completed_at: null,
      created_by: ctx.userId,
    },
  ])
  if (expErr) throw new Error(`experiments insert: ${expErr.message}`)

  // Per-item results for experiment 1 (all complete)
  const resultRows: Array<Record<string, unknown>> = []
  for (let i = 0; i < datasets.supportItemIds.length; i++) {
    const itemId = datasets.supportItemIds[i]!
    const scoreA = Math.max(0, Math.min(1, 0.71 + jitter(i, 0.2)))
    const scoreB = Math.max(0, Math.min(1, 0.82 + jitter(i + 5, 0.18)))
    resultRows.push({
      id: randomUUID(),
      organization_id: ctx.orgId,
      experiment_id: exp1Id,
      dataset_item_id: itemId,
      output_a: 'Sorry for the trouble. Please reach out again.',
      output_b: 'I apologize for the delay. I am escalating now and will follow up within 2 hours.',
      score_a: Number(scoreA.toFixed(3)),
      score_b: Number(scoreB.toFixed(3)),
      reasoning_a: 'Generic, no concrete next step.',
      reasoning_b: 'Empathetic and offers concrete next step.',
      cost_a_usd: 0.00018,
      cost_b_usd: 0.00024,
      tokens_a: 320,
      tokens_b: 410,
      latency_a_ms: 880 + Math.round(jitter(i, 200)),
      latency_b_ms: 1120 + Math.round(jitter(i + 3, 240)),
    })
  }

  // Partial results for experiment 2
  for (let i = 0; i < exp2Completed; i++) {
    const itemId = datasets.intentItemIds[i]!
    resultRows.push({
      id: randomUUID(),
      organization_id: ctx.orgId,
      experiment_id: exp2Id,
      dataset_item_id: itemId,
      output_a: 'order_status',
      output_b: '{"intent": "order_status"}',
      score_a: i % 4 === 0 ? 0 : 1,
      score_b: 1,
      reasoning_a: 'Match',
      reasoning_b: 'JSON format matches schema',
      cost_a_usd: 0.00008,
      cost_b_usd: 0.00010,
      tokens_a: 180,
      tokens_b: 220,
      latency_a_ms: 320,
      latency_b_ms: 410,
    })
  }

  const { error: resErr } = await supabase.from('experiment_results').insert(resultRows)
  if (resErr) throw new Error(`experiment_results insert: ${resErr.message}`)

  console.log(`   2 experiments, ${resultRows.length} item results`)
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log('━'.repeat(64))
  console.log('  Spanlens — local test account seeder')
  console.log('━'.repeat(64))

  await cleanup()
  const ctx = await createAccount()
  await seedTraces(ctx)
  await seedRequests(ctx)
  const prompts = await seedPrompts(ctx)
  const datasets = await seedDatasets(ctx)
  await seedEvals(ctx, prompts, datasets)
  await seedExperiments(ctx, prompts, datasets)

  console.log('\n' + '━'.repeat(64))
  console.log('  ✅ Test account ready')
  console.log('━'.repeat(64))
  console.log(`  URL:        http://localhost:3000/login`)
  console.log(`  Email:      ${TEST_EMAIL}`)
  console.log(`  Password:   ${TEST_PASSWORD}`)
  console.log(`  Workspace:  ${TEST_ORG_NAME}`)
  console.log(`  Org ID:     ${ctx.orgId}`)
  console.log(`  Projects:`)
  console.log(`    customer-support-app   ${ctx.projectIds.app}`)
  console.log(`    analytics-pipeline     ${ctx.projectIds.pipeline}`)
  console.log('━'.repeat(64))
  console.log('  Seeded pages:')
  console.log('    /requests    250 calls across 5 models')
  console.log('    /traces      6 agent traces with spans')
  console.log('    /prompts     4 prompts, 11 versions')
  console.log('    /datasets    2 datasets, 22 items')
  console.log('    /evals       3 evaluators, 4 runs')
  console.log('    /experiments 1 completed (v2 vs v3), 1 running')
  console.log('    /savings     auto-derived (gpt-4o, claude-sonnet, gemini-pro)')
  console.log('━'.repeat(64))
  console.log('  No Spanlens keys or provider keys were created.')
  console.log('  Issue keys via the UI when you need to make proxy calls.')
  console.log('━'.repeat(64) + '\n')
}

main().catch((err) => {
  console.error('\n❌ seed failed:', err)
  process.exit(1)
})
