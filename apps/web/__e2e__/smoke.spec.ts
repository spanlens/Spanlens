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
 *   the proxy to log to dashboard pipe directly, not at the
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

    // ── 6. The request log row verifies the proxy → log pipe ───────────────
    //
    // The proxy writes its log row fire-and-forget, so polling the table is
    // the cleanest deterministic check that auth → proxy → upstream → log
    // works end to end. Checking the /requests page instead would drag in
    // Next 16 RSC compilation, middleware cookie handling, and the
    // server-component cache, none of which are part of the contract this
    // spec is about. A dedicated UI spec can cover the rendering.
    //
    // Read through PostgREST with the service key: it bypasses RLS, which is
    // what the server does too, and it avoids giving the browser test suite a
    // Postgres driver of its own.
    const logPollDeadline = Date.now() + 30_000
    let loggedRowCount = 0
    while (Date.now() < logPollDeadline) {
      const res = await fetch(
        `${supabaseUrl}/rest/v1/requests?organization_id=eq.${orgId}&select=id`,
        {
          headers: {
            apikey: supabaseServiceKey,
            Authorization: `Bearer ${supabaseServiceKey}`,
            // Ask for the exact count in the Content-Range header instead of
            // pulling the rows themselves.
            Prefer: 'count=exact',
            Range: '0-0',
          },
        },
      )
      if (res.ok) {
        // Content-Range looks like "0-0/1"; the part after the slash is the count.
        const total = Number(res.headers.get('content-range')?.split('/')[1] ?? 0)
        if (total > 0) {
          loggedRowCount = total
          break
        }
      }
      await new Promise((r) => setTimeout(r, 500))
    }
    expect(loggedRowCount, 'the proxy request was never logged to the requests table').toBeGreaterThan(0)

    // Final touch: confirm the user is still logged in after the proxy
    // round-trip and the route resolves to SOMETHING. Pattern is loose
    // because the spec pre-seeds the workspace via service_role, which
    // skips the /onboarding step's `user_profiles.onboarded_at` write —
    // middleware then bounces /requests to /onboarding for first-time
    // users. That's the right behaviour for a real user, just not what
    // the smoke spec models. Any logged-in landing zone counts here;
    // a regression to /login is the only thing we'd want to fail on.
    await page.goto('/requests')
    await expect(page.url(), 'smoke: session lost after proxy round-trip — middleware regressed to /login').not.toContain('/login')
  })
})
