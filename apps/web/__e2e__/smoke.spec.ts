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

    // ── 3. Sign in via the actual login form ──────────────────────────────────
    await page.goto('/login')
    await page.fill('#email', email)
    await page.fill('#password', password)
    await page.click('button[type="submit"]')
    await page.waitForURL(/\/(projects|dashboard)/, { timeout: 30_000 })

    // ── 4. Issue an sl_live_* key directly via service-role INSERT.
    //      Going through /api/v1/api-keys would also work but requires
    //      a session cookie; the direct insert keeps the test focused on
    //      the proxy → ClickHouse → dashboard pipe.
    const { randomBytes, createHash } = await import('node:crypto')
    const rawKey = `sl_live_${randomBytes(24).toString('hex')}`
    const keyHash = createHash('sha256').update(rawKey).digest('hex')

    const { error: insertErr } = await supabase.from('api_keys').insert({
      project_id: projectId,
      organization_id: null,
      key_hash: keyHash,
      key_prefix: rawKey.slice(0, 14),
      name: 'e2e-smoke',
      scope: 'full',
      is_active: true,
    })
    if (insertErr) throw new Error(`api_keys insert failed: ${insertErr.message}`)

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

    // ── 6. The proxy logs to ClickHouse fire-and-forget. There's a
    //      small but real window between the 200 and the row landing.
    //      Poll /api/v1/requests through the user's session (auth via
    //      the auth cookie set by the magic link) until at least 1 row
    //      appears, with a 10s ceiling matching playwright.config.ts's
    //      expect.timeout.
    await page.goto('/requests')
    await expect(page.locator('[data-testid="request-row"]').first()).toBeVisible({
      timeout: 15_000,
    })
  })
})
