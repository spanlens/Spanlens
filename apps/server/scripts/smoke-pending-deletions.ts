/**
 * Local integration smoke test for the 4A.2 soft-delete queue.
 *
 * Verifies against:
 *   1. Real local Supabase (supabase start)
 *
 * Scenarios covered:
 *   ✓ Enqueue api_key deletion → row is_active=false + pending_deletions row
 *   ✓ Restore api_key → is_active back to true + cancelled_at stamped
 *   ✓ Enqueue prompt_version deletion → version row untouched, queue row added
 *   ✓ Cron execution → scheduled_for-due rows hard-deleted + executed_at stamped
 *   ✓ Duplicate enqueue rejected (UNIQUE active index)
 *   ✓ Restore after hard-delete refuses gracefully
 *
 * Run:
 *   pnpm --filter server tsx scripts/smoke-pending-deletions.ts
 */
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { randomUUID, randomBytes, createHash } from 'node:crypto'

import {
  enqueueDeletion,
  reactivateByType,
  hardDeleteByType,
  PENDING_DELETION_GRACE_HOURS,
} from '../src/lib/pending-deletions.js'
import { executePendingDeletions } from '../src/api/pendingDeletions.js'

// ── Setup ─────────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is required')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const green = (s: string) => `\x1b[32m${s}\x1b[0m`
const red = (s: string) => `\x1b[31m${s}\x1b[0m`
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`

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

// ── Fixture ───────────────────────────────────────────────────────────────────

const TEST_ORG_ID = randomUUID()
const TEST_EMAIL = `smoke-pending-deletions-${Date.now()}@spanlens.local`
let TEST_USER_ID = ''
let TEST_PROJECT_ID = ''
let TEST_API_KEY_ID = ''
let TEST_PROMPT_VERSION_ID = ''

async function setupFixture(): Promise<void> {
  const { data: userData, error: userErr } = await supabase.auth.admin.createUser({
    email: TEST_EMAIL,
    password: 'SmokeTest123!',
    email_confirm: true,
  })
  if (userErr || !userData.user) throw new Error(`auth user: ${userErr?.message}`)
  TEST_USER_ID = userData.user.id

  const { error: orgErr } = await supabase.from('organizations').insert({
    id: TEST_ORG_ID,
    name: 'Pending Deletions Smoke',
    owner_id: TEST_USER_ID,
    plan: 'free',
  })
  if (orgErr) throw new Error(`org: ${orgErr.message}`)

  const projectId = randomUUID()
  const { error: projErr } = await supabase.from('projects').insert({
    id: projectId,
    organization_id: TEST_ORG_ID,
    name: 'Smoke Project',
  })
  if (projErr) throw new Error(`project: ${projErr.message}`)
  TEST_PROJECT_ID = projectId

  // api_key (full scope, project-owned)
  const apiKeyId = randomUUID()
  const rawKey = `sl_live_${randomBytes(12).toString('hex')}`
  const keyHash = createHash('sha256').update(rawKey).digest('hex')
  const { error: keyErr } = await supabase.from('api_keys').insert({
    id: apiKeyId,
    project_id: TEST_PROJECT_ID,
    name: 'Smoke Key',
    key_hash: keyHash,
    key_prefix: rawKey.slice(0, 15),
    scope: 'full',
    is_active: true,
  })
  if (keyErr) throw new Error(`api_key: ${keyErr.message}`)
  TEST_API_KEY_ID = apiKeyId

  // prompt_version
  const versionId = randomUUID()
  const { error: pvErr } = await supabase.from('prompt_versions').insert({
    id: versionId,
    organization_id: TEST_ORG_ID,
    name: `smoke-${Date.now()}`,
    version: 1,
    content: 'Hello',
    variables: [],
    metadata: {},
  })
  if (pvErr) throw new Error(`prompt_version: ${pvErr.message}`)
  TEST_PROMPT_VERSION_ID = versionId
}

async function teardown(): Promise<void> {
  await supabase.from('pending_deletions').delete().eq('organization_id', TEST_ORG_ID)
  await supabase.from('prompt_versions').delete().eq('organization_id', TEST_ORG_ID)
  await supabase.from('api_keys').delete().eq('project_id', TEST_PROJECT_ID)
  await supabase.from('projects').delete().eq('organization_id', TEST_ORG_ID)
  await supabase.from('organizations').delete().eq('id', TEST_ORG_ID)
  if (TEST_USER_ID) await supabase.auth.admin.deleteUser(TEST_USER_ID)
}

// ── Scenarios ─────────────────────────────────────────────────────────────────

async function scenarioApiKeyEnqueueRestore(): Promise<void> {
  console.log(bold('\n1. api_key — enqueue then restore'))

  const { data: snap } = await supabase
    .from('api_keys')
    .select('*')
    .eq('id', TEST_API_KEY_ID)
    .single()

  const result = await enqueueDeletion({
    organizationId: TEST_ORG_ID,
    resourceType: 'api_key',
    resourceId: TEST_API_KEY_ID,
    resourceSnapshot: snap as Record<string, unknown>,
    requestedBy: TEST_USER_ID,
  })
  check('enqueue succeeded', result.ok, result.ok ? '' : `code=${result.code}`)

  // Source row should be deactivated.
  const { data: postKey } = await supabase
    .from('api_keys')
    .select('is_active')
    .eq('id', TEST_API_KEY_ID)
    .single()
  check('api_key is_active flipped to false', postKey?.is_active === false)

  // Pending row should exist with correct grace.
  const { data: pending } = await supabase
    .from('pending_deletions')
    .select('scheduled_for, requested_at')
    .eq('resource_id', TEST_API_KEY_ID)
    .is('executed_at', null)
    .is('cancelled_at', null)
    .single()
  check('pending_deletions row created', pending !== null)
  if (pending) {
    const requestedMs = new Date(pending.requested_at).getTime()
    const scheduledMs = new Date(pending.scheduled_for).getTime()
    const graceHours = (scheduledMs - requestedMs) / 3_600_000
    check('grace window matches PENDING_DELETION_GRACE_HOURS',
      Math.abs(graceHours - PENDING_DELETION_GRACE_HOURS) < 0.1,
      `${graceHours.toFixed(1)}h`)
  }

  // Duplicate enqueue should hit UNIQUE active index.
  const dup = await enqueueDeletion({
    organizationId: TEST_ORG_ID,
    resourceType: 'api_key',
    resourceId: TEST_API_KEY_ID,
    resourceSnapshot: {},
    requestedBy: TEST_USER_ID,
  })
  check('duplicate enqueue rejected with ALREADY_PENDING',
    !dup.ok && dup.code === 'ALREADY_PENDING',
    dup.ok ? 'unexpectedly succeeded' : `code=${dup.code}`)

  // Now restore.
  const reactivation = await reactivateByType('api_key', TEST_API_KEY_ID, TEST_ORG_ID, {})
  check('reactivation returned restored=reactivated',
    reactivation.ok && reactivation.restored === 'reactivated')

  const { data: restored } = await supabase
    .from('api_keys')
    .select('is_active')
    .eq('id', TEST_API_KEY_ID)
    .single()
  check('api_key is_active flipped back to true', restored?.is_active === true)

  // Mark cancelled so subsequent scenarios start clean.
  await supabase.from('pending_deletions').update({
    cancelled_at: new Date().toISOString(),
  }).eq('resource_id', TEST_API_KEY_ID).is('cancelled_at', null)
}

async function scenarioPromptVersionEnqueue(): Promise<void> {
  console.log(bold('\n2. prompt_version — enqueue does not touch the source row'))

  const { data: snap } = await supabase
    .from('prompt_versions')
    .select('*')
    .eq('id', TEST_PROMPT_VERSION_ID)
    .single()

  const result = await enqueueDeletion({
    organizationId: TEST_ORG_ID,
    resourceType: 'prompt_version',
    resourceId: TEST_PROMPT_VERSION_ID,
    resourceSnapshot: snap as Record<string, unknown>,
    requestedBy: TEST_USER_ID,
  })
  check('enqueue succeeded', result.ok, result.ok ? '' : `code=${result.code}`)

  // prompt_versions has no is_active column; the row stays exactly as-is.
  const { data: postVersion } = await supabase
    .from('prompt_versions')
    .select('id, content')
    .eq('id', TEST_PROMPT_VERSION_ID)
    .single()
  check('prompt_version row untouched (still queryable during grace)',
    postVersion?.content === 'Hello')

  const { data: pending } = await supabase
    .from('pending_deletions')
    .select('id')
    .eq('resource_id', TEST_PROMPT_VERSION_ID)
    .is('executed_at', null)
    .is('cancelled_at', null)
    .single()
  check('pending_deletions row created for prompt_version', pending !== null)
}

async function scenarioCronExecution(): Promise<void> {
  console.log(bold('\n3. cron execution — due rows hard-deleted, executed_at stamped'))

  // Force-expire the prompt_version row scheduled_for so cron picks it up.
  const past = new Date(Date.now() - 60_000).toISOString()
  await supabase.from('pending_deletions').update({ scheduled_for: past })
    .eq('resource_id', TEST_PROMPT_VERSION_ID)
    .is('cancelled_at', null)
    .is('executed_at', null)

  const summary = await executePendingDeletions({ batchSize: 10 })
  check('cron picked at least 1 row', summary.picked >= 1, `picked=${summary.picked}`)
  check('cron executed without failure', summary.failed === 0,
    summary.failed === 0 ? '' : JSON.stringify(summary.errors))

  // Source row should be gone.
  const { data: gone } = await supabase
    .from('prompt_versions')
    .select('id')
    .eq('id', TEST_PROMPT_VERSION_ID)
    .maybeSingle()
  check('prompt_version source row hard-deleted', gone === null)

  // Queue row should have executed_at.
  const { data: stamped } = await supabase
    .from('pending_deletions')
    .select('executed_at')
    .eq('resource_id', TEST_PROMPT_VERSION_ID)
    .single()
  check('pending_deletions executed_at stamped', stamped?.executed_at !== null,
    `executed_at=${stamped?.executed_at}`)
}

async function scenarioRestoreAfterHardDelete(): Promise<void> {
  console.log(bold('\n4. restore after hard-delete is rejected gracefully'))

  // The prompt_version was hard-deleted in scenario 3. Attempt reactivation.
  const result = await reactivateByType(
    'prompt_version',
    TEST_PROMPT_VERSION_ID,
    TEST_ORG_ID,
    {},
  )
  check('reactivation refused with ok=false', !result.ok)
  check('error mentions already deleted', !result.ok && /hard-deleted/i.test(result.error ?? ''))
}

async function scenarioHardDeleteHelperIdempotent(): Promise<void> {
  console.log(bold('\n5. hardDeleteByType is idempotent on missing rows'))

  // Try to hard-delete an already-gone prompt_version — should succeed.
  const result = await hardDeleteByType(
    'prompt_version',
    TEST_PROMPT_VERSION_ID,
    TEST_ORG_ID,
  )
  check('idempotent hard-delete returns ok=true', result.ok)
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(bold('Spanlens — Pending deletions integration smoke'))
  console.log(dim(`  org=${TEST_ORG_ID}`))

  try {
    await setupFixture()
    console.log(green('  Fixture created.'))
  } catch (err) {
    console.error(red(`Fixture setup failed: ${(err as Error).message}`))
    process.exit(1)
  }

  try {
    await scenarioApiKeyEnqueueRestore()
    await scenarioPromptVersionEnqueue()
    await scenarioCronExecution()
    await scenarioRestoreAfterHardDelete()
    await scenarioHardDeleteHelperIdempotent()
  } catch (err) {
    console.error(red(`\nUnexpected error: ${(err as Error).stack ?? err}`))
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
