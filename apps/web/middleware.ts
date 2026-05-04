import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * Session validation + auth redirects.
 *
 * Called on every navigation request (except static assets and `/api/*`
 * which is the same-origin proxy — see matcher). Validates the Supabase
 * session via `getUser()`, then forwards `x-spanlens-user-id` /
 * `x-spanlens-org-id` request headers downstream so the dashboard layout
 * does NOT need to re-call `getUser()` — one round-trip per navigation
 * instead of two.
 */

const PUBLIC_PATHS = ['/', '/pricing', '/login', '/signup', '/auth/', '/terms', '/privacy', '/invite', '/demo', '/waitlist']

// Pre-launch: redirect /login and /signup to /waitlist until June 3, 2026.
// Remove this block on launch day.
const LAUNCH_DATE = new Date('2026-06-03T00:00:00+09:00')
const PRE_LAUNCH = Date.now() < LAUNCH_DATE.getTime()

export async function middleware(request: NextRequest) {
  // Skip auth middleware when Supabase env vars are absent (local preview without .env.local)
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return NextResponse.next()
  }

  const requestHeaders = new Headers(request.headers)
  let supabaseResponse = NextResponse.next({
    request: { headers: requestHeaders },
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({
            request: { headers: requestHeaders },
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const path = request.nextUrl.pathname
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(p))

  if (!user && !isPublic) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  if (user && (path === '/login' || path === '/signup')) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  // Pre-launch redirect: unauthenticated /login and /signup → /waitlist.
  // ?direct=1 bypasses this for existing alpha users.
  // Remove this block on June 3, 2026 launch day.
  if (PRE_LAUNCH && !user && (path === '/login' || path === '/signup')) {
    const bypass = request.nextUrl.searchParams.get('direct')
    if (!bypass) {
      const url = request.nextUrl.clone()
      url.pathname = '/waitlist'
      return NextResponse.redirect(url)
    }
  }

  // Forward auth metadata downstream so the dashboard layout can skip its
  // own getUser() call. One Supabase round-trip per navigation total.
  if (user) {
    requestHeaders.set('x-spanlens-user-id', user.id)

    // Workspace resolution mirrors the server's authJwt:
    //   1. `sb-ws` cookie — explicit choice from the sidebar switcher.
    //   2. app_metadata.org_id — legacy (created by the old onboarding flow).
    //   3. Oldest org_members row — default for invited-only users.
    let orgId: string | undefined
    const preferredWs = request.cookies.get('sb-ws')?.value
    const appMetaOrg = (user.app_metadata as { org_id?: string } | undefined)?.org_id

    let onboarded = false

    if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
      try {
        const admin = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY,
          { auth: { persistSession: false } },
        )

        if (preferredWs) {
          const { data: preferred } = await admin
            .from('org_members')
            .select('organization_id')
            .eq('user_id', user.id)
            .eq('organization_id', preferredWs)
            .maybeSingle()
          if (preferred?.organization_id) orgId = preferred.organization_id
        }

        if (!orgId && appMetaOrg) orgId = appMetaOrg

        if (!orgId) {
          const { data: m } = await admin
            .from('org_members')
            .select('organization_id')
            .eq('user_id', user.id)
            .order('created_at', { ascending: true })
            .limit(1)
            .maybeSingle()
          if (m?.organization_id) orgId = m.organization_id
        }

        // Onboarding completion. Cheap (PK lookup on user_profiles) and
        // unlocks the dashboard layout's `redirect('/onboarding')` guard
        // without round-tripping to the API on every page load.
        const { data: profile } = await admin
          .from('user_profiles')
          .select('onboarded_at')
          .eq('user_id', user.id)
          .maybeSingle()
        if (profile?.onboarded_at) onboarded = true
      } catch {
        // Non-fatal — worst case the user sees /onboarding and can retry.
      }
    } else if (appMetaOrg) {
      orgId = appMetaOrg
    }

    if (orgId) requestHeaders.set('x-spanlens-org-id', orgId)
    if (onboarded) requestHeaders.set('x-spanlens-onboarded', '1')

    // Re-materialize the response with the updated headers so downstream RSC
    // (notably (dashboard)/layout.tsx) sees them via next/headers.
    supabaseResponse = NextResponse.next({
      request: { headers: requestHeaders },
    })
  }

  return supabaseResponse
}

export const config = {
  // Skip static assets + the `/api/*` proxy (handled by next.config rewrites
  // to the upstream server, which enforces its own JWT).
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
