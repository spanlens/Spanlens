import { TERMS_VERSION, PRIVACY_VERSION, DPA_VERSION } from './legal-versions'

/**
 * Server-side helper invoked from the OAuth callback route handler.
 *
 * The email signup flow records Terms + Privacy + DPA consent client-side
 * (signup/page.tsx:21-40) before calling signUp — but only when signUp
 * returns a session inline. When email confirmation is enabled the session
 * is null until the user clicks the confirmation link, which lands on
 * /auth/callback (emailRedirectTo). So both the OAuth flow AND the
 * email-confirmation flow reach this helper without consent recorded yet.
 *
 * The OAuth flow skips the client-side step entirely — the user clicks
 * "Continue with Google/GitHub" and bounces straight to the provider.
 * By the time we see them again in the callback we've already implicitly
 * accepted their consent (the notice next to the SSO buttons covers it).
 *
 * This helper closes both gaps: after exchangeCodeForSession succeeds we
 * check whether this user has already accepted the current TERMS /
 * PRIVACY / DPA versions, and POST any missing rows to /api/v1/me/consent.
 * Idempotent — safe to call on every callback (including OAuth
 * re-logins for users who accepted long ago).
 *
 * The endpoint captures IP + UA from the request server-side, so we
 * deliberately do not forward them here.
 *
 * ## SSRF hardening
 *
 * Earlier revisions took an `origin` argument derived from the request
 * URL and built `${origin}/api/v1/me/consent`. CodeQL flagged this as
 * `js/request-forgery` (critical): the callback route derives origin
 * from `x-forwarded-host`, which is attacker-controllable, so a
 * malicious header would have caused this helper to POST the user's
 * access token to an external server. The Authorization header carries
 * a live Supabase JWT — leaking that to an attacker is account takeover.
 *
 * Fix: pin the destination to the server URL configured at build /
 * deploy time (`API_URL` / `NEXT_PUBLIC_API_URL`), exactly the same
 * source `next.config.mjs` uses for its `/api/*` rewrite. The request
 * never depends on user input again.
 */

interface ConsentRow {
  document: 'terms' | 'privacy' | 'dpa'
  version: string
}

interface ConsentListResponse {
  success?: boolean
  data?: ConsentRow[]
}

function getServerBase(): string {
  // Mirror the resolution order in apps/web/next.config.mjs so the
  // helper and the rewrite always target the same upstream server.
  return (
    process.env.API_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    'http://localhost:3001'
  )
}

export async function recordOAuthConsentIfMissing(
  accessToken: string,
): Promise<void> {
  const base = getServerBase()
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`,
  }

  const existingRes = await fetch(`${base}/api/v1/me/consent`, {
    headers,
    cache: 'no-store',
  })

  let existing: ConsentRow[] = []
  if (existingRes.ok) {
    const body = (await existingRes.json().catch(() => ({}))) as ConsentListResponse
    existing = body.data ?? []
  }

  const required: ConsentRow[] = [
    { document: 'terms', version: TERMS_VERSION },
    { document: 'privacy', version: PRIVACY_VERSION },
    { document: 'dpa', version: DPA_VERSION },
  ]

  const missing = required.filter(
    (r) => !existing.some((e) => e.document === r.document && e.version === r.version),
  )
  if (missing.length === 0) return

  await fetch(`${base}/api/v1/me/consent`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ documents: missing }),
  })
}
