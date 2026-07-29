/**
 * End-to-end smoke test for the @spanlens/sdk Vercel AI integration.
 *
 * Drives `createSpanlensTracker` through the same callback shape Vercel AI
 * SDK's `generateText` / `streamText` emit, then verifies the trace + span
 * actually landed in Supabase. Runs against the local server (localhost:3001)
 * — no real OpenAI call needed (the tracker is duck-typed on the callback
 * objects, not the AI SDK package).
 *
 * Run:
 *   pnpm --filter server tsx scripts/test-vercel-ai-integration.ts
 */
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
// Local relative imports — apps/server doesn't declare @spanlens/sdk as a
// workspace dep, so we point at the built dist directly. Run
// `pnpm --filter sdk build` before this script if the dist is stale.
import { SpanlensClient } from '../../../packages/sdk/dist/index.js'
import { createSpanlensTracker } from '../../../packages/sdk/dist/integrations/vercel-ai.js'

const SERVER_URL = 'http://localhost:3001'
const SUPABASE_URL = process.env['SUPABASE_URL'] ?? 'http://127.0.0.1:54321'
const SUPABASE_SERVICE_ROLE =
  process.env['SUPABASE_SERVICE_ROLE_KEY'] ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
const SUPABASE_ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

const TEST_EMAIL = 'testuser@spanlens.local'
const TEST_PASSWORD = 'TestPass123!'

function log(...args: unknown[]): void {
  console.log(...args)
}

async function getJwt(): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
  })
  if (!res.ok) throw new Error(`auth login: ${res.status} ${await res.text()}`)
  const body = (await res.json()) as { access_token: string }
  return body.access_token
}

async function findOrCreateProject(jwt: string): Promise<{ projectId: string }> {
  // GET existing projects
  const listRes = await fetch(`${SERVER_URL}/api/v1/projects`, {
    headers: { Authorization: `Bearer ${jwt}` },
  })
  if (listRes.ok) {
    const env = (await listRes.json()) as { data: Array<{ id: string; name: string }> }
    const first = env.data?.[0]
    if (first) return { projectId: first.id }
  }
  throw new Error('no project found for test account — seed first')
}

async function issueFullKey(jwt: string, projectId: string): Promise<string> {
  const name = `vercel-ai-smoke-${randomUUID().slice(0, 8)}`
  const res = await fetch(`${SERVER_URL}/api/v1/api-keys/issue`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, projectId, scope: 'full' }),
  })
  if (!res.ok) throw new Error(`issue key: ${res.status} ${await res.text()}`)
  const body = (await res.json()) as { data: { key: string } }
  return body.data.key
}

async function fetchTraceWithSpans(
  supabase: ReturnType<typeof createClient>,
  traceName: string,
  startedAfterMs: number,
): Promise<{ trace: any; spans: any[] } | null> {
  // Poll a few times — ingest is fire-and-forget so the trace lands a beat
  // after onFinish returns.
  for (let i = 0; i < 6; i++) {
    const { data: trace } = await supabase
      .from('traces')
      .select('*')
      .eq('name', traceName)
      .gte('created_at', new Date(startedAfterMs).toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (trace) {
      const { data: spans } = await supabase
        .from('spans')
        .select('*')
        .eq('trace_id', (trace as { id: string }).id)
        .order('started_at', { ascending: true })
      return { trace, spans: spans ?? [] }
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  return null
}

async function main(): Promise<void> {
  log('━'.repeat(64))
  log('  Vercel AI SDK integration smoke test')
  log('━'.repeat(64))

  log('\n[1] Logging in as test account...')
  const jwt = await getJwt()
  log('    JWT acquired')

  log('\n[2] Looking up a project to attach the key to...')
  const { projectId } = await findOrCreateProject(jwt)
  log(`    project: ${projectId}`)

  log('\n[3] Issuing a full-access Spanlens key (ingest requires full)...')
  const apiKey = await issueFullKey(jwt, projectId)
  // Nothing derived from the key goes to stdout, not a truncated prefix and
  // not its length: `sl_live_` is a fixed 8 chars, so an 18-char prefix leaked
  // 10 hex chars of the secret, and CodeQL treats any read off `apiKey` as a
  // clear-text-logging sink. The call below either works or throws.
  log('    key issued (scope: full)')

  log('\n[4] Setting up SpanlensClient + createSpanlensTracker...')
  const client = new SpanlensClient({ apiKey, baseUrl: SERVER_URL })
  const traceName = `ai.generate.smoke-${randomUUID().slice(0, 8)}`
  const startedAtMs = Date.now()
  const tracker = createSpanlensTracker({ client, traceName, modelName: 'gpt-4o-mini' })
  log(`    trace started: ${traceName}`)

  log('\n[5] Simulating a 2-step tool call run...')
  // Mirror the shape Vercel AI SDK's onStepFinish emits between tool calls.
  await tracker.onStepFinish({
    usage: { promptTokens: 480, completionTokens: 30, totalTokens: 510 },
    finishReason: 'tool-calls',
    stepType: 'initial',
    text: '',
    response: { id: 'resp_step1', modelId: 'gpt-4o-mini-2024-07-18' },
  })
  await tracker.onStepFinish({
    usage: { promptTokens: 950, completionTokens: 84, totalTokens: 1034 },
    finishReason: 'stop',
    stepType: 'continue',
    text: 'Refund processed. The order will be re-shipped within 2 business days.',
    response: { id: 'resp_step2', modelId: 'gpt-4o-mini-2024-07-18' },
  })
  log('    onStepFinish × 2 OK')

  log('\n[6] Firing onFinish with cumulative usage...')
  await tracker.onFinish({
    usage: { promptTokens: 1430, completionTokens: 114, totalTokens: 1544 },
    finishReason: 'stop',
    text: 'Refund processed. The order will be re-shipped within 2 business days.',
    response: { id: 'resp_final', modelId: 'gpt-4o-mini-2024-07-18' },
  })
  await client.flush()
  log('    onFinish fired + client.flush() returned')

  log('\n[7] Verifying trace + span landed in Supabase...')
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const found = await fetchTraceWithSpans(supabase, traceName, startedAtMs - 1000)
  if (!found) {
    throw new Error('trace not found after polling — ingest did not complete')
  }

  log('\n' + '━'.repeat(64))
  log('  ✅ trace landed')
  log('━'.repeat(64))
  log(`  trace.id          : ${found.trace.id}`)
  log(`  trace.name        : ${found.trace.name}`)
  log(`  trace.status      : ${found.trace.status}`)
  log(`  trace.duration_ms : ${found.trace.duration_ms}`)
  log(`  trace.span_count  : ${found.trace.span_count}`)
  log(`  trace.total_tokens: ${found.trace.total_tokens}`)
  log(`  trace.cost_usd    : ${found.trace.total_cost_usd}`)
  log(`\n  spans (${found.spans.length}):`)
  for (const s of found.spans) {
    log(`    - [${s.span_type}] ${s.name}`)
    log(`         status=${s.status}  duration=${s.duration_ms}ms`)
    log(`         tokens=${s.prompt_tokens}/${s.completion_tokens}/${s.total_tokens}`)
    log(`         metadata=${JSON.stringify(s.metadata)}`)
  }
  log('━'.repeat(64))

  // Assertions
  const expectedSpan = found.spans.find((s) => s.span_type === 'llm')
  if (!expectedSpan) {
    throw new Error('FAIL: no llm span recorded')
  }
  if (expectedSpan.total_tokens !== 1544) {
    throw new Error(
      `FAIL: total_tokens mismatch — got ${expectedSpan.total_tokens}, expected 1544`,
    )
  }
  if (expectedSpan.status !== 'completed') {
    throw new Error(`FAIL: span status — got ${expectedSpan.status}, expected completed`)
  }
  const meta = expectedSpan.metadata as { model?: string; finishReason?: string; steps?: number }
  if (meta?.model !== 'gpt-4o-mini-2024-07-18') {
    throw new Error(`FAIL: model not resolved from response — got ${meta?.model}`)
  }
  if (meta?.steps !== 2) {
    throw new Error(`FAIL: step count not tracked — got ${meta?.steps}, expected 2`)
  }
  log('\n  ✅ assertions: tokens / status / model / step count all match\n')
}

main().catch((err) => {
  console.error('\n❌ smoke test failed:', err)
  process.exit(1)
})
