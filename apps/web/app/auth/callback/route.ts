import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { recordOAuthConsentIfMissing } from '@/lib/oauth-consent'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const next = url.searchParams.get('next') ?? '/dashboard'

  if (code) {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)

    // OAuth signups skip the explicit Terms/Privacy checkbox shown to
    // email signups. Record current-version acceptance here so legal
    // audit history is consistent across both paths. Idempotent —
    // re-logins for existing users will no-op after the first record.
    if (!error && data.session?.access_token) {
      try {
        await recordOAuthConsentIfMissing(data.session.access_token, url.origin)
      } catch (err) {
        // Non-fatal — the consent endpoint is best-effort here, same
        // policy as the email signup flow (signup/page.tsx:34).
        console.error('[auth/callback] consent recording failed:', err)
      }
    }
  }

  return NextResponse.redirect(new URL(next, url.origin))
}
