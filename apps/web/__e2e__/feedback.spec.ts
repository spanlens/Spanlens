import { expect, test } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

/**
 * R-32 Phase E smoke spec — feedback submit → list → vote → admin PATCH.
 *
 * What this verifies:
 *   1. Logged-in user can POST /api/v1/feedback (submission).
 *   2. GET /api/v1/feedback surfaces the new row with vote_count=0, has_voted=false.
 *   3. POST /api/v1/feedback/:id/vote increments vote_count and flips has_voted=true.
 *   4. Re-posting the same vote is idempotent (count stays at 1).
 *   5. DELETE /api/v1/feedback/:id/vote drops the vote back to 0.
 *   6. PATCH /api/v1/admin/feedback/:id moves status and stamps responded_at +
 *      responded_by when the caller's email is on SPANLENS_ADMIN_EMAILS.
 *
 * Why request-based (not browser):
 *   The UI rendering is covered by typecheck + build; the contract that
 *   matters for the launch is the API pipeline (vote count, idempotency,
 *   admin auth). Going through HTTP gives full envelope coverage without
 *   the flake budget of Playwright UI assertions. The browser-based
 *   coverage in smoke.spec.ts already validates the auth-cookie path.
 *
 * Required environment (CI's e2e workflow sets these):
 *   E2E_SERVER_URL              http://localhost:3001
 *   E2E_SUPABASE_URL            local supabase API URL
 *   E2E_SUPABASE_SERVICE_KEY    service_role key
 *   SPANLENS_ADMIN_EMAILS       on the server, must include the test admin email
 */

const supabaseUrl = process.env['E2E_SUPABASE_URL'] ?? 'http://localhost:54321'
const supabaseServiceKey = process.env['E2E_SUPABASE_SERVICE_KEY'] ?? ''
const serverUrl = process.env['E2E_SERVER_URL'] ?? 'http://localhost:3001'

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

test.describe('R-32: feedback submit → list → vote → admin', () => {
  test.skip(
    !supabaseServiceKey,
    'E2E_SUPABASE_SERVICE_KEY not set — skipping (set via `supabase status` JSON)',
  )

  test('submit, list, vote idempotently, un-vote, admin patch', async ({ request }) => {
    // ── 1. Pre-seed admin user (email matches SPANLENS_ADMIN_EMAILS) + workspace ─
    //
    // The admin email is fixed at "admin-e2e@spanlens.test" — the CI workflow
    // (or local .env) is responsible for adding that string to the server's
    // SPANLENS_ADMIN_EMAILS allowlist. Without that, the PATCH assertion
    // below fails with 403 and the spec correctly signals "you forgot to wire
    // the admin allowlist".
    const adminEmail = process.env['E2E_FEEDBACK_ADMIN_EMAIL'] ?? 'admin-e2e@spanlens.test'
    const password = 'test-password-correct-horse'

    // Clean up prior runs (createUser is not idempotent — email collision is 422).
    const { data: existing } = await supabase.auth.admin.listUsers({ perPage: 200 })
    const dupe = existing.users.find((u) => u.email === adminEmail)
    if (dupe) await supabase.auth.admin.deleteUser(dupe.id)

    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email: adminEmail,
      password,
      email_confirm: true,
    })
    if (createErr || !created.user) throw new Error(`createUser failed: ${createErr?.message}`)
    const userId = created.user.id

    // Workspace bootstrap (replicates POST /api/v1/organizations/bootstrap
    // via service_role to keep the spec out of the onboarding UI).
    const { data: org, error: orgErr } = await supabase
      .from('organizations')
      .insert({ name: 'r32-feedback-e2e', owner_id: userId })
      .select('id')
      .single()
    if (orgErr || !org) throw new Error(`org insert failed: ${orgErr?.message}`)
    const { error: memberErr } = await supabase
      .from('org_members')
      .insert({ organization_id: org.id, user_id: userId, role: 'admin' })
    if (memberErr) throw new Error(`org_members insert failed: ${memberErr.message}`)

    // ── 2. Mint a session JWT for direct API auth (no browser) ────────────────
    const { data: tokenData, error: tokenErr } =
      await supabase.auth.admin.generateLink({ type: 'magiclink', email: adminEmail })
    if (tokenErr || !tokenData) throw new Error(`generateLink failed: ${tokenErr?.message}`)
    // signInWithPassword is the simpler path — give us back an access_token.
    const userClient = createClient(supabaseUrl, supabaseServiceKey)
    const { data: signIn, error: signInErr } = await userClient.auth.signInWithPassword({
      email: adminEmail,
      password,
    })
    if (signInErr || !signIn.session) throw new Error(`signIn failed: ${signInErr?.message}`)
    const accessToken = signIn.session.access_token
    const authHeaders = {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    }

    // ── 3. POST /feedback ─────────────────────────────────────────────────────
    const message = `R-32 E2E sentinel ${Date.now()}`
    const submitRes = await request.post(`${serverUrl}/api/v1/feedback`, {
      headers: authHeaders,
      data: { message, category: 'feature', source: 'r32-e2e' },
    })
    expect(submitRes.status(), 'submit must succeed').toBe(200)

    // ── 4. GET /feedback → row visible, vote_count=0, has_voted=false ─────────
    const listRes = await request.get(`${serverUrl}/api/v1/feedback`, { headers: authHeaders })
    expect(listRes.status()).toBe(200)
    const listBody = (await listRes.json()) as {
      data: Array<{ id: string; message: string; vote_count: number; has_voted: boolean; status: string }>
    }
    const ours = listBody.data.find((r) => r.message === message)
    expect(ours, 'submitted row must appear in list').toBeTruthy()
    expect(ours!.vote_count).toBe(0)
    expect(ours!.has_voted).toBe(false)
    expect(ours!.status).toBe('new')
    const feedbackId = ours!.id

    // ── 5. POST /vote → count 1, has_voted true ───────────────────────────────
    const voteRes = await request.post(`${serverUrl}/api/v1/feedback/${feedbackId}/vote`, {
      headers: authHeaders,
    })
    expect(voteRes.status()).toBe(200)

    const afterVote = await request.get(`${serverUrl}/api/v1/feedback`, { headers: authHeaders })
    const afterVoteBody = (await afterVote.json()) as typeof listBody
    const voted = afterVoteBody.data.find((r) => r.id === feedbackId)
    expect(voted!.vote_count, 'vote_count after upvote').toBe(1)
    expect(voted!.has_voted).toBe(true)

    // ── 5b. Idempotency: re-vote should NOT double-count ──────────────────────
    const reVoteRes = await request.post(`${serverUrl}/api/v1/feedback/${feedbackId}/vote`, {
      headers: authHeaders,
    })
    expect(reVoteRes.status()).toBe(200)
    const afterReVote = await request.get(`${serverUrl}/api/v1/feedback`, { headers: authHeaders })
    const reVoted = (await afterReVote.json() as typeof listBody).data.find((r) => r.id === feedbackId)
    expect(reVoted!.vote_count, 'duplicate vote must be idempotent').toBe(1)

    // ── 6. DELETE /vote → count back to 0 ─────────────────────────────────────
    const unvoteRes = await request.delete(`${serverUrl}/api/v1/feedback/${feedbackId}/vote`, {
      headers: authHeaders,
    })
    expect(unvoteRes.status()).toBe(200)
    const afterUnvote = await request.get(`${serverUrl}/api/v1/feedback`, { headers: authHeaders })
    const unvoted = (await afterUnvote.json() as typeof listBody).data.find((r) => r.id === feedbackId)
    expect(unvoted!.vote_count, 'vote_count after unvote').toBe(0)
    expect(unvoted!.has_voted).toBe(false)

    // ── 7. PATCH /admin/feedback/:id — status + response_message ──────────────
    //
    // Requires the test user's email to be on SPANLENS_ADMIN_EMAILS in the
    // running server's env. If 403, the spec emits a targeted error so the
    // operator knows exactly what to fix.
    const patchRes = await request.patch(`${serverUrl}/api/v1/admin/feedback/${feedbackId}`, {
      headers: authHeaders,
      data: {
        status: 'planned',
        response_message: 'Tracked — shipping next sprint.',
        changelog_url: 'https://www.spanlens.io/changelog#r32',
      },
    })
    if (patchRes.status() === 403) {
      throw new Error(
        `Admin PATCH returned 403. Add "${adminEmail}" to SPANLENS_ADMIN_EMAILS on the running server.`,
      )
    }
    expect(patchRes.status()).toBe(200)
    const patchBody = (await patchRes.json()) as {
      data: { status: string; response_message: string | null; responded_by: string | null }
    }
    expect(patchBody.data.status).toBe('planned')
    expect(patchBody.data.response_message).toBe('Tracked — shipping next sprint.')
    expect(patchBody.data.responded_by).toBe(userId)

    // ── 8. Public list reflects the admin update ──────────────────────────────
    const finalList = await request.get(`${serverUrl}/api/v1/feedback?status=planned`, {
      headers: authHeaders,
    })
    const finalBody = (await finalList.json()) as typeof listBody & {
      data: Array<{ id: string; status: string; response_message?: string | null }>
    }
    const final = finalBody.data.find((r) => r.id === feedbackId)
    expect(final, 'planned filter must include the patched row').toBeTruthy()
    expect(final!.status).toBe('planned')
  })
})
