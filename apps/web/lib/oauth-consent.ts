import { TERMS_VERSION, PRIVACY_VERSION } from './legal-versions'

/**
 * Server-side helper invoked from the OAuth callback route handler.
 *
 * The email signup flow records Terms + Privacy consent client-side
 * (signup/page.tsx:19-37) before calling signUp. The OAuth flow skips
 * that step — the user clicks "Continue with Google/GitHub" and bounces
 * straight to the provider. By the time we see them again in the
 * callback we've already implicitly accepted their consent.
 *
 * This helper closes the gap: after exchangeCodeForSession succeeds we
 * check whether this user has already accepted the current TERMS /
 * PRIVACY versions, and POST any missing rows to /api/v1/me/consent.
 * Idempotent — safe to call on every callback (including OAuth
 * re-logins for users who accepted long ago).
 *
 * The endpoint captures IP + UA from the request server-side, so we
 * deliberately do not forward them here.
 */

interface ConsentRow {
  document: 'terms' | 'privacy'
  version: string
}

interface ConsentListResponse {
  success?: boolean
  data?: ConsentRow[]
}

export async function recordOAuthConsentIfMissing(
  accessToken: string,
  origin: string,
): Promise<void> {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`,
  }

  const existingRes = await fetch(`${origin}/api/v1/me/consent`, {
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
  ]

  const missing = required.filter(
    (r) => !existing.some((e) => e.document === r.document && e.version === r.version),
  )
  if (missing.length === 0) return

  await fetch(`${origin}/api/v1/me/consent`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ documents: missing }),
  })
}
