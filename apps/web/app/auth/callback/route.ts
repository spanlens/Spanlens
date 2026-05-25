import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { recordOAuthConsentIfMissing } from '@/lib/oauth-consent'

/**
 * OAuth + magic-link callback. Exchanges `?code=...` for a Supabase
 * session and redirects to `next` (default `/dashboard`).
 *
 * Cookie handling follows the Supabase SSR official pattern: build the
 * NextResponse first, then have the supabase client write its session
 * cookies directly onto that response. The previous shape — set cookies
 * via `cookies()` store, then return a fresh `NextResponse.redirect()` —
 * worked inconsistently because Next.js does not always flush
 * cookie-store mutations into a brand-new Response built later in the
 * handler. Symptom: OAuth succeeded but the dashboard never saw the
 * session and middleware bounced the user back to /login.
 *
 * `x-forwarded-host` is honored so Vercel preview / production URLs
 * redirect to the user-facing host rather than the internal
 * deployment URL.
 *
 * Terms + Privacy consent for first-time OAuth signups is recorded
 * out-of-band via fire-and-forget — the redirect must not wait on a
 * server round-trip. Helper is idempotent so re-logins do nothing.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/dashboard'

  const forwardedHost = request.headers.get('x-forwarded-host')
  const isLocal = process.env.NODE_ENV === 'development'
  const redirectBase =
    isLocal || !forwardedHost ? origin : `https://${forwardedHost}`

  if (!code) {
    return NextResponse.redirect(`${redirectBase}${next}`)
  }

  const response = NextResponse.redirect(`${redirectBase}${next}`)
  const cookieStore = await cookies()

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options)
          })
        },
      },
    },
  )

  const { data, error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    return NextResponse.redirect(
      `${redirectBase}/login?error=${encodeURIComponent(mapOAuthError(error))}`,
    )
  }

  // Fire-and-forget. The redirect response is already prepared; we
  // don't want to block the user on an audit-log round-trip. apps/web
  // runs under the Node.js runtime by default, so the function process
  // stays alive long enough for this promise to settle. If it doesn't,
  // the helper is idempotent — the next sign-in tries again.
  if (data.session?.access_token) {
    recordOAuthConsentIfMissing(data.session.access_token, redirectBase).catch(
      (err: unknown) => {
        console.error('[auth/callback] consent recording failed:', err)
      },
    )
  }

  return response
}

/**
 * Translate a Supabase auth error into a stable query-string code that
 * the login page can match without depending on Supabase's wording.
 * Add new cases here as we observe them in production logs — Supabase
 * error shapes change between SDK versions, so defaulting to a generic
 * code is the safe path.
 */
function mapOAuthError(error: { message?: string | null }): string {
  const msg = error.message?.toLowerCase() ?? ''
  if (msg.includes('email') && (msg.includes('already') || msg.includes('exists'))) {
    return 'email_conflict'
  }
  if (msg.includes('identity') && msg.includes('exists')) {
    return 'identity_already_linked'
  }
  if (msg.includes('provider') && msg.includes('disabled')) {
    return 'provider_disabled'
  }
  return 'oauth_callback_failed'
}
