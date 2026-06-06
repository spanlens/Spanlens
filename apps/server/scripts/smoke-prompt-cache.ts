/**
 * Local integration smoke test for the 4A.1 prompt resolve cache.
 *
 * Verifies the cache against:
 *   1. Real Upstash-compatible Redis (docker hiett/serverless-redis-http)
 *   2. Real local Supabase Postgres (supabase start)
 *
 * Scenarios covered:
 *   ✓ Cold start → cache populated after first resolve
 *   ✓ Cache hit → DB skipped (verified via supabase row count delta)
 *   ✓ Invalidation clears all keys for a prompt name
 *   ✓ A/B experiment metadata cached (not arm decision) — split preserved
 *   ✓ Read during invalidation lock returns null (cache miss → DB)
 *
 * Run:
 *   pnpm --filter server tsx scripts/smoke-prompt-cache.ts
 *
 * Prereqs:
 *   - supabase start  (local stack running on :54321)
 *   - docker run hiett/serverless-redis-http on :8079 with token
 *   - apps/server/.env has KV_REST_API_URL + KV_REST_API_TOKEN set
 */
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { Redis } from '@upstash/redis'
import { randomUUID } from 'node:crypto'

import {
  _internals,
  invalidatePromptName,
} from '../src/lib/prompt-cache.js'
import { resolvePromptVersion } from '../src/lib/resolve-prompt-version.js'

// ── Setup ─────────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const KV_URL = process.env.KV_REST_API_URL!
const KV_TOKEN = process.env.KV_REST_API_TOKEN!

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is required')
  process.exit(1)
}
if (!KV_URL || !KV_TOKEN) {
  console.error('KV_REST_API_URL and KV_REST_API_TOKEN are required')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const redis = new Redis({ url: KV_URL, token: KV_TOKEN })

const green = (s: string) => `\x1b[32m${s}\x1b[0m`
const red = (s: string) => `\x1b[31m${s}\x1b[0m`
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`
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

// ── Test fixture ──────────────────────────────────────────────────────────────

const TEST_ORG_ID = randomUUID()
const TEST_EMAIL = `smoke-prompt-cache-${Date.now()}@spanlens.local`
let TEST_USER_ID = ''
const PROMPT_NAME = `smoke-test-${Date.now()}`

async function setupFixture(): Promise<{ versionA: string; versionB: string }> {
  // Create a real auth user — organizations.owner_id has an FK to auth.users.
  const { data: userData, error: userErr } = await supabase.auth.admin.createUser({
    email: TEST_EMAIL,
    password: 'SmokeTest123!',
    email_confirm: true,
  })
  if (userErr || !userData.user) {
    throw new Error(`auth user create failed: ${userErr?.message ?? 'unknown'}`)
  }
  TEST_USER_ID = userData.user.id

  const { error: orgErr } = await supabase.from('organizations').insert({
    id: TEST_ORG_ID,
    name: 'Prompt Cache Smoke',
    owner_id: TEST_USER_ID,
    plan: 'free',
  })
  if (orgErr) throw new Error(`org insert failed: ${orgErr.message}`)

  const versionA = randomUUID()
  const versionB = randomUUID()

  const { error: pvErr } = await supabase.from('prompt_versions').insert([
    {
      id: versionA,
      organization_id: TEST_ORG_ID,
      name: PROMPT_NAME,
      version: 1,
      content: 'Hello {{name}}',
      variables: [],
      metadata: {},
    },
    {
      id: versionB,
      organization_id: TEST_ORG_ID,
      name: PROMPT_NAME,
      version: 2,
      content: 'Hi {{name}}!',
      variables: [],
      metadata: {},
    },
  ])
  if (pvErr) throw new Error(`prompt_versions insert failed: ${pvErr.message}`)

  return { versionA, versionB }
}

async function teardown(): Promise<void> {
  // Cascade via org delete.
  await supabase.from('prompt_ab_experiments').delete().eq('organization_id', TEST_ORG_ID)
  await supabase.from('prompt_versions').delete().eq('organization_id', TEST_ORG_ID)
  await supabase.from('organizations').delete().eq('id', TEST_ORG_ID)
  if (TEST_USER_ID) {
    await supabase.auth.admin.deleteUser(TEST_USER_ID)
  }
  // Clear any leftover redis keys for this test prompt.
  await invalidatePromptName(TEST_ORG_ID, PROMPT_NAME)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Raw Redis GET — bypasses the read-if-unlocked Lua wrapper.
 *
 * Note: @upstash/redis auto-parses JSON on GET, so we always re-stringify
 * non-null/non-string values so the caller can hand them to
 * `parseCachedLatest()` without caring about the wire format.
 */
async function rawGet(key: string): Promise<string | null> {
  const v = await redis.get<unknown>(key)
  if (v === null || v === undefined) return null
  return typeof v === 'string' ? v : JSON.stringify(v)
}

// ── Scenarios ─────────────────────────────────────────────────────────────────

async function scenarioColdStart(versionA: string): Promise<void> {
  console.log(bold('\n1. Cold start — resolve populates cache'))

  // Ensure cache is empty for this prompt.
  await invalidatePromptName(TEST_ORG_ID, PROMPT_NAME)
  // After invalidate, the LOCK key is held for ~10s. Wait for it to expire
  // so the writes below succeed via SET_IF_UNLOCKED.
  await new Promise((r) => setTimeout(r, 11_000))

  const latestKey = _internals.latestKey(TEST_ORG_ID, PROMPT_NAME)
  const before = await rawGet(latestKey)
  check('latest key empty before first resolve', before === null, `got ${before}`)

  // name@latest → should hit DB, return version 2 (highest), and cache it.
  const result = await resolvePromptVersion(TEST_ORG_ID, `${PROMPT_NAME}@latest`)
  check('resolve returned a versionId', result !== null && typeof result?.versionId === 'string')
  check('resolved to highest version (version 2)', result?.versionId !== versionA,
    `versionId=${result?.versionId}`)
  check('no experiment hint on plain latest', result?.experimentId === undefined)

  // Cache should now hold the single-version entry.
  const after = await rawGet(latestKey)
  check('latest key populated after first resolve', after !== null,
    after ? `${after.slice(0, 60)}...` : 'null')

  if (after) {
    const parsed = _internals.parseCachedLatest(after)
    check('cached value is kind=single', parsed?.kind === 'single')
    if (parsed?.kind === 'single') {
      check('cached versionId matches resolve result', parsed.versionId === result?.versionId)
    }
  }
}

async function scenarioCacheHit(): Promise<void> {
  console.log(bold('\n2. Cache hit — second resolve skips DB'))

  const latestKey = _internals.latestKey(TEST_ORG_ID, PROMPT_NAME)
  const lockKey = _internals.lockKey(TEST_ORG_ID, PROMPT_NAME)

  // Clear any stale lock from earlier scenarios (the 11s wait in scenario 1
  // should already have expired it, but belt-and-braces).
  await redis.del(lockKey)

  const sentinelVersionId = 'sentinel-cache-' + randomUUID()
  const sentinelPayload = JSON.stringify({ kind: 'single', versionId: sentinelVersionId })
  await redis.set(latestKey, sentinelPayload, { ex: 60 })

  // Sanity: read it back through our rawGet path so we can confirm what's
  // actually stored before the resolve call exercises the Lua-wrapped read.
  const stored = await rawGet(latestKey)
  check('sentinel write persisted (raw GET)',
    stored !== null && stored.includes(sentinelVersionId),
    stored ? stored.slice(0, 80) : 'null')

  const result = await resolvePromptVersion(TEST_ORG_ID, `${PROMPT_NAME}@latest`)
  check('resolve returned the sentinel value (proves cache hit)',
    result?.versionId === sentinelVersionId,
    `versionId=${result?.versionId}`)
}

async function scenarioInvalidate(versionA: string): Promise<void> {
  console.log(bold('\n3. Invalidate clears all keys for this prompt name'))

  // Pre-populate both latest and nv keys.
  const latestKey = _internals.latestKey(TEST_ORG_ID, PROMPT_NAME)
  const nvKey = _internals.nameVersionKey(TEST_ORG_ID, PROMPT_NAME, 1)

  await redis.set(latestKey, JSON.stringify({ kind: 'single', versionId: 'will-be-invalidated' }),
    { ex: 60 })
  await redis.set(nvKey, versionA, { ex: 60 })

  const latestBefore = await rawGet(latestKey)
  const nvBefore = await rawGet(nvKey)
  check('latest key present before invalidate', latestBefore !== null)
  check('nv key present before invalidate', nvBefore !== null)

  await invalidatePromptName(TEST_ORG_ID, PROMPT_NAME)

  const latestAfter = await rawGet(latestKey)
  const nvAfter = await rawGet(nvKey)
  check('latest key deleted after invalidate', latestAfter === null,
    latestAfter ? `still present: ${latestAfter}` : '')
  check('nv key deleted after invalidate', nvAfter === null,
    nvAfter ? `still present: ${nvAfter}` : '')

  // Lock should be held for ~10s.
  const lockKey = _internals.lockKey(TEST_ORG_ID, PROMPT_NAME)
  const lock = await rawGet(lockKey)
  check('write lock held immediately after invalidate', lock !== null)
}

async function scenarioReadDuringLock(): Promise<void> {
  console.log(bold('\n4. Read during invalidation lock returns null (cache bypass)'))

  // Step 1: write a value into the cache without going through SET_IF_UNLOCKED
  // so we have something to potentially serve.
  const latestKey = _internals.latestKey(TEST_ORG_ID, PROMPT_NAME)
  // Force the lock to expire from the previous scenario first.
  const lockKey = _internals.lockKey(TEST_ORG_ID, PROMPT_NAME)
  await redis.del(lockKey)

  await redis.set(latestKey, JSON.stringify({ kind: 'single', versionId: 'cached-pre-lock' }),
    { ex: 60 })
  const beforeLock = await rawGet(latestKey)
  check('cache populated before lock', beforeLock !== null)

  // Step 2: simulate an invalidation in progress by taking only the lock.
  await redis.set(lockKey, '1', { ex: 10 })

  // Step 3: call resolvePromptVersion — getCachedLatest goes through
  // READ_IF_UNLOCKED which should refuse to read while the lock is held.
  // The resolve will then fall through to DB.
  const result = await resolvePromptVersion(TEST_ORG_ID, `${PROMPT_NAME}@latest`)
  check('resolve falls through to DB despite cached value',
    result?.versionId !== 'cached-pre-lock',
    `versionId=${result?.versionId}`)

  await redis.del(lockKey)
}

async function scenarioExperimentMetadataCaching(
  versionA: string,
  versionB: string,
): Promise<void> {
  console.log(bold('\n5. A/B experiment — metadata cached, arm split preserved per trace'))

  // Start an A/B experiment.
  await invalidatePromptName(TEST_ORG_ID, PROMPT_NAME)
  await new Promise((r) => setTimeout(r, 11_000))

  const { error: expErr } = await supabase.from('prompt_ab_experiments').insert({
    organization_id: TEST_ORG_ID,
    prompt_name: PROMPT_NAME,
    version_a_id: versionA,
    version_b_id: versionB,
    traffic_split: 50,
    status: 'running',
  })
  if (expErr) {
    check('experiment insert', false, expErr.message)
    return
  }

  // First call populates the cache with experiment metadata.
  const r1 = await resolvePromptVersion(TEST_ORG_ID, `${PROMPT_NAME}@latest`, 'trace-id-aaa')
  check('first resolve returned experimentId', typeof r1?.experimentId === 'string',
    `experimentId=${r1?.experimentId}`)
  check('first resolve assigned an arm', r1?.experimentArm === 'a' || r1?.experimentArm === 'b',
    `arm=${r1?.experimentArm}`)

  const latestKey = _internals.latestKey(TEST_ORG_ID, PROMPT_NAME)
  const cached = await rawGet(latestKey)
  const parsed = cached ? _internals.parseCachedLatest(cached) : null
  check('cached value is kind=experiment', parsed?.kind === 'experiment')

  // Critical check: many distinct traceIds should produce BOTH arms, even
  // though they're all hitting the cache. This proves arm assignment is NOT
  // cached — only the experiment metadata is.
  const armsByTrace = new Set<string>()
  for (let i = 0; i < 20; i++) {
    const r = await resolvePromptVersion(TEST_ORG_ID, `${PROMPT_NAME}@latest`, `trace-${i}`)
    if (r?.experimentArm) armsByTrace.add(r.experimentArm)
  }
  check('arm split preserved (both a and b produced across 20 traces)',
    armsByTrace.has('a') && armsByTrace.has('b'),
    `seen arms: ${[...armsByTrace].join(',')}`)

  // Same traceId → same arm (deterministic).
  const r2 = await resolvePromptVersion(TEST_ORG_ID, `${PROMPT_NAME}@latest`, 'trace-id-aaa')
  check('same traceId yields same arm (deterministic routing)',
    r2?.experimentArm === r1?.experimentArm,
    `r1=${r1?.experimentArm}, r2=${r2?.experimentArm}`)
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(bold('Spanlens — Prompt resolve cache integration smoke'))
  console.log(dim(`  org=${TEST_ORG_ID}`))
  console.log(dim(`  prompt=${PROMPT_NAME}`))
  console.log(dim(`  redis=${KV_URL}`))

  let versionA: string, versionB: string
  try {
    const fixture = await setupFixture()
    versionA = fixture.versionA
    versionB = fixture.versionB
    console.log(green('\n  Fixture created.'))
  } catch (err) {
    console.error(red(`\nFixture setup failed: ${(err as Error).message}`))
    process.exit(1)
  }

  try {
    await scenarioColdStart(versionA)
    await scenarioCacheHit()
    await scenarioInvalidate(versionA)
    await scenarioReadDuringLock()
    await scenarioExperimentMetadataCaching(versionA, versionB)
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
