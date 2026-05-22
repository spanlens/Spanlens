#!/usr/bin/env node
/**
 * Inserts org/project/api_key/provider_keys into the local Supabase DB so the
 * proxy can be exercised end-to-end without the web signup flow.
 *
 * Uses raw fetch to PostgREST so we don't need supabase-js installed at the
 * scripts/ root.
 *
 * Throwaway: smoke test session 2026-05-22.
 */

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const OPENAI_KEY = process.env.SMOKE_OPENAI_KEY
const GEMINI_KEY = process.env.SMOKE_GEMINI_KEY
const ANTHROPIC_KEY = process.env.SMOKE_ANTHROPIC_KEY

if (!ENCRYPTION_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Set ENCRYPTION_KEY and SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}
if (!OPENAI_KEY || !GEMINI_KEY || !ANTHROPIC_KEY) {
  console.error('Set SMOKE_OPENAI_KEY, SMOKE_GEMINI_KEY, SMOKE_ANTHROPIC_KEY')
  process.exit(1)
}

// ── crypto helpers (mirrored from apps/server/src/lib/crypto.ts) ────────────
const ALGORITHM = 'AES-GCM'
const IV_LENGTH = 12
const TAG_LENGTH = 16

function base64ToBytes(b64) {
  return Uint8Array.from(Buffer.from(b64, 'base64'))
}
function bytesToBase64(bytes) {
  return Buffer.from(bytes).toString('base64')
}

async function getKey() {
  const keyBytes = base64ToBytes(ENCRYPTION_KEY)
  if (keyBytes.length !== 32) throw new Error('ENCRYPTION_KEY must decode to 32 bytes')
  return crypto.subtle.importKey('raw', keyBytes, { name: ALGORITHM }, false, ['encrypt'])
}

async function aes256Encrypt(plaintext) {
  const key = await getKey()
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
  const encoded = new TextEncoder().encode(plaintext)
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt({ name: ALGORITHM, iv }, key, encoded),
  )
  const cipherOnly = encrypted.subarray(0, encrypted.length - TAG_LENGTH)
  const tag = encrypted.subarray(encrypted.length - TAG_LENGTH)
  const result = new Uint8Array(IV_LENGTH + TAG_LENGTH + cipherOnly.length)
  result.set(iv, 0)
  result.set(tag, IV_LENGTH)
  result.set(cipherOnly, IV_LENGTH + TAG_LENGTH)
  return bytesToBase64(result)
}

function randomHex(bytes) {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('')
}

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text)
  const buf = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
}

// ── PostgREST helper ────────────────────────────────────────────────────────
async function pgInsert(table, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`${table} INSERT failed (${res.status}): ${text}`)
  }
  return JSON.parse(text)
}

// ── set up DB rows ──────────────────────────────────────────────────────────
console.log('1. Creating auth user (owner)...')
const userRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
  method: 'POST',
  headers: {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    email: `smoke-${Date.now()}@example.com`,
    password: 'smoke-test-' + randomHex(8),
    email_confirm: true,
  }),
})
const userData = await userRes.json()
if (!userRes.ok) {
  console.error('auth user create failed:', userData)
  process.exit(1)
}
const ownerId = userData.id
console.log('   owner_id =', ownerId)

console.log('2. Creating organization...')
const [org] = await pgInsert('organizations', {
  name: 'Smoke Test Org',
  plan: 'team',
  owner_id: ownerId,
})
console.log('   org_id =', org.id)

console.log('3. Creating project...')
const [project] = await pgInsert('projects', {
  organization_id: org.id,
  name: 'smoke-test',
})
console.log('   project_id =', project.id)

console.log('4. Generating Spanlens key...')
const rawKey = 'sl_live_' + randomHex(24)
const keyHash = await sha256Hex(rawKey)
const keyPrefix = rawKey.slice(0, 12)
const [apiKey] = await pgInsert('api_keys', {
  project_id: project.id,
  name: 'smoke-test-key',
  key_hash: keyHash,
  key_prefix: keyPrefix,
})
console.log('   api_key_id =', apiKey.id)

console.log('5. Encrypting + inserting provider keys...')
const providers = [
  { provider: 'openai',    plain: OPENAI_KEY,    name: 'smoke-openai' },
  { provider: 'gemini',    plain: GEMINI_KEY,    name: 'smoke-gemini' },
  { provider: 'anthropic', plain: ANTHROPIC_KEY, name: 'smoke-anthropic' },
]
for (const p of providers) {
  const encrypted = await aes256Encrypt(p.plain)
  await pgInsert('provider_keys', {
    organization_id: org.id,
    api_key_id: apiKey.id,
    provider: p.provider,
    name: p.name,
    encrypted_key: encrypted,
  })
  console.log(`   ${p.provider}: stored (encrypted ${encrypted.length}b)`)
}

console.log('\n── READY ────────────────────────────────────────────────────')
console.log('export SPANLENS_KEY=' + rawKey)
console.log('export ORG_ID=' + org.id)
console.log('export PROJECT_ID=' + project.id)
console.log('─────────────────────────────────────────────────────────────')
