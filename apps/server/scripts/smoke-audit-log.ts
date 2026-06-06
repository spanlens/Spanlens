/**
 * Local integration smoke test for the audit_log mutation coverage.
 *
 * Verifies that the high-impact mutation handlers record an audit row when
 * called directly (helpers are called as if from inside the handler).
 *
 * Coverage targets:
 *   ✓ recordAuditEvent / recordAuditLog write rows with normalised shape
 *   ✓ Missing organization_id is dropped (warning only, no throw)
 *   ✓ ip extraction prefers x-forwarded-for client hop
 *
 * Run:
 *   pnpm --filter server tsx scripts/smoke-audit-log.ts
 */
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

import {
  auditContextFromHono,
  recordAuditEvent,
  recordAuditLog,
} from '../src/lib/audit-log.js'

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY required')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const green = (s: string) => `\x1b[32m${s}\x1b[0m`
const red = (s: string) => `\x1b[31m${s}\x1b[0m`
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`

let pass = 0
let fail = 0

function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    console.log(`  ${green('✓')} ${label}${detail ? dim(` (${detail})`) : ''}`)
    pass++
  } else {
    console.log(`  ${red('✗')} ${label}${detail ? red(` — ${detail}`) : ''}`)
    fail++
  }
}

// ── Fixture (real org + user so the FK constraint is happy) ──────────────────

const TEST_ORG_ID = randomUUID()
const TEST_EMAIL = `smoke-audit-${Date.now()}@spanlens.local`
let TEST_USER_ID = ''

async function setup(): Promise<void> {
  const { data: u, error: uErr } = await supabase.auth.admin.createUser({
    email: TEST_EMAIL,
    password: 'SmokeTest123!',
    email_confirm: true,
  })
  if (uErr || !u.user) throw new Error(`user: ${uErr?.message}`)
  TEST_USER_ID = u.user.id

  const { error } = await supabase.from('organizations').insert({
    id: TEST_ORG_ID,
    name: 'Audit Smoke',
    owner_id: TEST_USER_ID,
    plan: 'free',
  })
  if (error) throw new Error(`org: ${error.message}`)
}

async function teardown(): Promise<void> {
  await supabase.from('audit_logs').delete().eq('organization_id', TEST_ORG_ID)
  await supabase.from('organizations').delete().eq('id', TEST_ORG_ID)
  if (TEST_USER_ID) await supabase.auth.admin.deleteUser(TEST_USER_ID)
}

// ── Minimal Hono ctx stub ────────────────────────────────────────────────────

interface FakeCtx {
  get(key: string): string | undefined
  req: { header(name: string): string | undefined }
}

function makeCtx(opts: {
  orgId?: string
  userId?: string
  headers?: Record<string, string>
}): FakeCtx {
  return {
    get: (k) =>
      k === 'orgId' ? opts.orgId : k === 'userId' ? opts.userId : undefined,
    req: { header: (name: string) => opts.headers?.[name.toLowerCase()] },
  }
}

// ── Scenarios ────────────────────────────────────────────────────────────────

async function scenarioDirectInsert(): Promise<void> {
  console.log(bold('\n1. recordAuditLog inserts a normalised row'))

  const eventResourceId = randomUUID()
  const ok = await recordAuditLog(
    { organizationId: TEST_ORG_ID, userId: TEST_USER_ID, ipAddress: '203.0.113.5' },
    {
      action: 'api_key.create',
      resourceType: 'api_keys',
      resourceId: eventResourceId,
      metadata: { scope: 'full', test: true },
    },
  )
  check('recordAuditLog returned true', ok)

  const { data } = await supabase
    .from('audit_logs')
    .select('action, resource_type, resource_id, user_id, ip_address, metadata')
    .eq('organization_id', TEST_ORG_ID)
    .eq('resource_id', eventResourceId)
    .single()

  check('row persisted', data !== null)
  check('action matches', data?.action === 'api_key.create')
  check('resource_type matches', data?.resource_type === 'api_keys')
  check('ip_address recorded', data?.ip_address === '203.0.113.5')
  const meta = (data?.metadata ?? {}) as Record<string, unknown>
  check('metadata preserved', meta.scope === 'full' && meta.test === true)
}

async function scenarioHonoExtraction(): Promise<void> {
  console.log(bold('\n2. recordAuditEvent extracts org/user/IP from Hono ctx'))

  const ctx = makeCtx({
    orgId: TEST_ORG_ID,
    userId: TEST_USER_ID,
    headers: { 'x-forwarded-for': '198.51.100.5, 10.0.0.1' },
  })

  const ipExtracted = auditContextFromHono(ctx as never).ipAddress
  check('x-forwarded-for first hop wins', ipExtracted === '198.51.100.5',
    `got ${ipExtracted}`)

  const resourceId = randomUUID()
  const ok = await recordAuditEvent(ctx as never, {
    action: 'provider_key.rotate',
    resourceType: 'provider_keys',
    resourceId,
    metadata: { provider: 'openai' },
  })
  check('recordAuditEvent succeeded', ok)

  const { data } = await supabase
    .from('audit_logs')
    .select('ip_address, user_id, action')
    .eq('organization_id', TEST_ORG_ID)
    .eq('resource_id', resourceId)
    .single()

  check('row carries Hono-derived IP', data?.ip_address === '198.51.100.5')
  check('row carries Hono-derived user_id', data?.user_id === TEST_USER_ID)
  check('action recorded', data?.action === 'provider_key.rotate')
}

async function scenarioMissingOrg(): Promise<void> {
  console.log(bold('\n3. Missing organization_id is dropped silently'))

  const ok = await recordAuditLog(
    { organizationId: null, userId: TEST_USER_ID },
    { action: 'noop.test', resourceType: 'noop' },
  )
  check('returns false instead of throwing', ok === false)
}

async function scenarioListMatchesInserts(): Promise<void> {
  console.log(bold('\n4. End-to-end: GET /audit-logs would see our rows'))

  const { data, error } = await supabase
    .from('audit_logs')
    .select('action')
    .eq('organization_id', TEST_ORG_ID)
    .order('created_at', { ascending: false })

  check('list query succeeds (RLS bypassed by service role)', error === null)
  const actions = (data ?? []).map((r) => r.action)
  check('api_key.create row visible', actions.includes('api_key.create'))
  check('provider_key.rotate row visible', actions.includes('provider_key.rotate'))
  check('noop.test row NOT inserted (org gate worked)',
    !actions.includes('noop.test'))
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(bold('Spanlens — Audit log integration smoke'))
  console.log(dim(`  org=${TEST_ORG_ID}`))

  try {
    await setup()
    console.log(green('  Fixture created.'))
  } catch (err) {
    console.error(red(`Setup failed: ${(err as Error).message}`))
    process.exit(1)
  }

  try {
    await scenarioDirectInsert()
    await scenarioHonoExtraction()
    await scenarioMissingOrg()
    await scenarioListMatchesInserts()
  } catch (err) {
    console.error(red(`\nUnexpected: ${(err as Error).stack ?? err}`))
    fail++
  } finally {
    await teardown()
  }

  console.log()
  console.log(bold(`Results: ${green(`${pass} pass`)}, ${fail === 0 ? green('0 fail') : red(`${fail} fail`)}`))
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(red(`Fatal: ${(err as Error).stack ?? err}`))
  process.exit(1)
})
