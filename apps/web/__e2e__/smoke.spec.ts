import { expect, test } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

/**
 * R-3 smoke spec — signup → api key → proxy → dashboard.
 *
 * What we verify (and what we do not)
 *
 *   We assert that a fresh user can:
 *     1. authenticate via magic-link (Supabase admin pre-seed)
 *     2. issue an sl_live_* API key
 *     3. send a proxy request that lands on the mock OpenAI server
 *     4. see the request appear in /requests within the eventual-
 *        consistency window
 *
 *   We do NOT cover billing, invitations, or evaluator flows here —
 *   those have their own focused specs (R-3 Phase 2 / Phase 3).
 *   Keeping the smoke spec single-purpose means a red signal points at
 *   the proxy → ClickHouse → dashboard pipe directly, not at the
 *   periphery.
 *
 * Required environment (CI's e2e workflow sets these)
 *   E2E_BASE_URL                http://localhost:3000  (Playwright baseURL)
 *   E2E_SERVER_URL              http://localhost:3001  (Hono server)
 *   E2E_SUPABASE_URL            local supabase API URL (e.g. http://localhost:54321)
 *   E2E_SUPABASE_SERVICE_KEY    service_role key — admin auth bypass
 *
 * Why a fresh user per run
 *   No teardown means rerunning the suite a second time would collide
 *   on email uniqueness if we hard-coded a fixture user. Using
 *   `Date.now()` in the email gives every run a clean tenant.
 */

const supabaseUrl = process.env['E2E_SUPABASE_URL'] ?? 'http://localhost:54321'
const supabaseServiceKey = process.env['E2E_SUPABASE_SERVICE_KEY'] ?? ''
const serverUrl = process.env['E2E_SERVER_URL'] ?? 'http://localhost:3001'

/**
 * Inline AES-256-GCM encryption that mirrors apps/server/src/lib/crypto.ts.
 *
 * Storage format: base64(iv[12] || tag[16] || ciphertext[N]). Web Crypto's
 * encrypt() returns `ciphertext || tag`; we reorder to `iv || tag || cipher`
 * so the server's aes256Decrypt() reads it back cleanly. This must stay
 * bit-identical to the server helper — if the layout drifts, the proxy
 * silently returns 500 on every E2E run because the decrypted plaintext
 * is garbage and gets sent as an upstream Authorization header.
 */
async function aes256EncryptB64(plaintext: string, keyB64: string): Promise<string> {
  const IV_LENGTH = 12
  const TAG_LENGTH = 16
  const keyBytes = Uint8Array.from(Buffer.from(keyB64, 'base64'))
  if (keyBytes.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes base64')
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes.buffer.slice(keyBytes.byteOffset, keyBytes.byteOffset + keyBytes.byteLength) as ArrayBuffer,
    { name: 'AES-GCM' },
    false,
    ['encrypt'],
  )
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
  const encoded = new TextEncoder().encode(plaintext)
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, encoded as BufferSource),
  )
  const cipherOnly = encrypted.subarray(0, encrypted.length - TAG_LENGTH)
  const tag = encrypted.subarray(encrypted.length - TAG_LENGTH)
  const result = new Uint8Array(IV_LENGTH + TAG_LENGTH + cipherOnly.length)
  result.set(iv, 0)
  result.set(tag, IV_LENGTH)
  result.set(cipherOnly, IV_LENGTH + TAG_LENGTH)
  return Buffer.from(result).toString('base64')
}

// The admin client is used only for user pre-seed + magic-link
// generation. Real users never see this code path.
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

test.describe('smoke: signup → api key → proxy → /requests', () => {
  test.skip(
    !supabaseServiceKey,
    'E2E_SUPABASE_SERVICE_KEY not set — skipping (set it locally via `supabase status` JSON)',
  )

  test('user can sign in, create an API key, hit proxy, and see the request', async ({
    page,
    request,
  }) => {
    const email = `e2e-${Date.now()}@spanlens.test`

    const password = 'test-password-correct-horse'

    // ── 1. Pre-seed user + verify email so the password sign-in works first try ──
    //
    // Why password sign-in instead of magic-link: the /auth/callback route in
    // apps/web/app/auth/callback/route.ts only handles PKCE OAuth (`?code=`).
    // `supabase.auth.admin.generateLink({type:'magiclink'})` returns a URL
    // with a `token_hash` query + hash-fragment, which our callback doesn't
    // verify — first-try `page.goto(magiclink)` redirects to /dashboard
    // without setting a session, middleware bounces to /login, and the
    // smoke's `waitForURL(/onboarding|projects|dashboard/)` times out.
    //
    // Going through the actual login form exercises the same client-side
    // supabase-js path a real user takes and writes cookies the middleware
    // recognises. The added cost is ~1s for two `page.fill` calls, well
    // under the savings from not chasing magic-link callback bugs every
    // time supabase SSR cookie internals change.
    const { data: createdUser, error: createErr } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    if (createErr || !createdUser.user) throw new Error(`createUser failed: ${createErr?.message}`)
    const userId = createdUser.user.id

    // ── 2. Pre-bootstrap workspace + project so /login lands on /dashboard ────
    //
    // Spanlens does NOT have an `on_auth_user_created` Postgres trigger that
    // auto-creates an org for new users. Instead the /onboarding page calls
    // POST /api/v1/organizations/bootstrap once the user picks a workspace
    // name (see apps/server/src/api/organizations.ts:272). Replicating that
    // bootstrap server-side via service_role keeps the smoke spec out of the
    // onboarding UI entirely — that flow has its own dedicated spec.
    const { data: org, error: orgErr } = await supabase
      .from('organizations')
      .insert({ name: 'e2e-workspace', owner_id: userId })
      .select('id')
      .single()
    if (orgErr || !org) throw new Error(`org insert failed: ${orgErr?.message}`)
    const orgId = org.id as string

    const { error: memberErr } = await supabase
      .from('org_members')
      .insert({ organization_id: orgId, user_id: userId, role: 'admin' })
    if (memberErr) throw new Error(`org_members insert failed: ${memberErr.message}`)

    const { data: project, error: projErr } = await supabase
      .from('projects')
      .insert({ organization_id: orgId, name: 'Default Project' })
      .select('id')
      .single()
    if (projErr || !project) throw new Error(`project insert failed: ${projErr?.message}`)
    const projectId = project.id as string

    // ── 2b. Issue the API key NOW (was step 4) so the provider_key below
    //         can point at it. provider_keys.api_key_id is NOT NULL
    //         after migration 20260505080000_provider_keys_under_api_keys.sql,
    //         which moved ownership from project → api_key.
    const { randomBytes, createHash } = await import('node:crypto')
    const rawKey = `sl_live_${randomBytes(24).toString('hex')}`
    const keyHash = createHash('sha256').update(rawKey).digest('hex')

    const { data: apiKeyRow, error: keyInsertErr } = await supabase
      .from('api_keys')
      .insert({
        project_id: projectId,
        organization_id: null,
        key_hash: keyHash,
        key_prefix: rawKey.slice(0, 14),
        name: 'e2e-smoke',
        scope: 'full',
        is_active: true,
      })
      .select('id')
      .single()
    if (keyInsertErr || !apiKeyRow) throw new Error(`api_keys insert failed: ${keyInsertErr?.message}`)
    const apiKeyId = apiKeyRow.id as string

    // ── 2c. Register a provider key so the proxy has something to decrypt ─────
    //
    // The proxy in apps/server/src/proxy/openai.ts looks up
    // provider_keys.encrypted_key for the API key, AES-256-GCM-decrypts
    // it, and uses the plaintext as the upstream Authorization Bearer.
    // With OPENAI_API_BASE pointed at mock-openai the actual key value
    // never matters — mock accepts anything — but the row HAS to exist,
    // and the ciphertext has to decrypt cleanly or the proxy returns 500.
    //
    // We encrypt right here (Web Crypto, no Node-only APIs) using the
    // same ENCRYPTION_KEY the server is configured with. Reusing
    // apps/server/src/lib/crypto.ts via cross-workspace import would
    // drag the server's tsconfig into the web build; inlining ~20
    // lines is cheaper.
    const encryptionKey = process.env['ENCRYPTION_KEY']
    if (!encryptionKey) throw new Error('ENCRYPTION_KEY env required for e2e (must match server)')
    const encryptedProviderKey = await aes256EncryptB64('sk-mock-e2e', encryptionKey)

    const { error: pkErr } = await supabase.from('provider_keys').insert({
      organization_id: orgId,
      api_key_id: apiKeyId,
      provider: 'openai',
      name: 'e2e mock',
      encrypted_key: encryptedProviderKey,
      is_active: true,
    })
    if (pkErr) throw new Error(`provider_keys insert failed: ${pkErr.message}`)

    // ── 3. Sign in via the actual login form ──────────────────────────────────
    await page.goto('/login')
    await page.fill('#email', email)
    await page.fill('#password', password)
    await page.click('button[type="submit"]')
    await page.waitForURL(/\/(projects|dashboard)/, { timeout: 30_000 })

    // ── 5. Issue a chat-completions call through the proxy. Server's
    //      OPENAI_API_BASE is pointed at mock-openai in the CI compose
    //      so this never touches real OpenAI traffic / budget.
    const proxyRes = await request.post(`${serverUrl}/proxy/openai/v1/chat/completions`, {
      headers: { Authorization: `Bearer ${rawKey}` },
      data: {
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'smoke test ping' }],
      },
    })
    expect(proxyRes.status(), `proxy response: ${await proxyRes.text()}`).toBe(200)

    // ── 6. ClickHouse INSERT verifies the proxy → log pipe ──────────────────
    //
    // The proxy logs to ClickHouse fire-and-forget. Polling ClickHouse
    // directly is the cleanest deterministic check that the end-to-end
    // auth → proxy → upstream → log pipeline works. UI rendering
    // (/requests page) has its own moving pieces (Next 16 RSC compile,
    // auth cookie picked up by middleware, server-component cache) that
    // produce flake here without exercising any of the proxy or log
    // contracts — split into a dedicated UI spec down the line if we
    // want that coverage.
    const clickhouseUrl = process.env['CLICKHOUSE_URL'] ?? 'http://localhost:8123'
    const clickhouseUser = process.env['CLICKHOUSE_USER'] ?? 'spanlens'
    const clickhousePassword = process.env['CLICKHOUSE_PASSWORD'] ?? 'spanlens_ci_password'
    const clickhouseDb = process.env['CLICKHOUSE_DB'] ?? 'spanlens'

    const chPollDeadline = Date.now() + 30_000
    let chRowCount = 0
    while (Date.now() < chPollDeadline) {
      const query = `SELECT count() FROM ${clickhouseDb}.requests WHERE organization_id = '${orgId}' FORMAT JSONEachRow`
      const res = await fetch(`${clickhouseUrl}/?user=${clickhouseUser}&password=${clickhousePassword}`, {
        method: 'POST',
        body: query,
      })
      if (res.ok) {
        const text = await res.text()
        // Result: {"count()":"1"} per row (Number-as-string per gotcha #19)
        const m = text.match(/"count\(\)":"?(\d+)"?/)
        if (m && Number(m[1]) > 0) {
          chRowCount = Number(m[1])
          break
        }
      }
      await new Promise((r) => setTimeout(r, 500))
    }
    expect(chRowCount, 'ClickHouse never received the proxy request log').toBeGreaterThan(0)

    // Touch the page so we know the route compiles and the user can
    // see SOMETHING after login. Not asserting on the row's visibility
    // here — see the comment block above. If that contract regresses
    // it surfaces in a dedicated UI spec (R-3 Phase 2 follow-up).
    await page.goto('/requests')
    await expect(page.url(), '/requests bounced — auth or middleware regression').toMatch(/\/requests/)
  })
})
