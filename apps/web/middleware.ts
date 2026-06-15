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

const PUBLIC_PATHS = ['/', '/pricing', '/login', '/signup', '/auth/', '/terms', '/privacy', '/invite', '/demo', '/forgot-password', '/reset-password']

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
        const admin = createServerClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!,
          {
            auth: { persistSession: false },
            cookies: { getAll: () => [], setAll: () => {} },
          },
        )

        // PT-2: every navigation used to serialise org resolution + onboarded
        // lookup as 2-3 Supabase round-trips. The onboarded check (user_profiles
        // PK lookup) is independent of the org pick, and the org pick's
        // preferred-vs-fallback lookups are independent of each other — only
        // their result-merge has a precedence rule. Fire all three in parallel
        // and decide afterwards: total latency drops to the slowest single
        // query (~50ms) instead of summing the chain.
        const [preferredRow, oldestRow, profileRow] = await Promise.all([
          preferredWs
            ? admin
                .from('org_members')
                .select('organization_id')
                .eq('user_id', user.id)
                .eq('organization_id', preferredWs)
                .maybeSingle()
                .then((r) => r.data?.organization_id ?? null)
            : Promise.resolve(null),
          // Oldest-membership fallback. Fired unconditionally because we don't
          // know in advance whether `preferredRow` or `appMetaOrg` will resolve
          // first — paying one cheap PK-indexed query saves a serial RT on the
          // no-preferred / no-appMeta path. The result is just dropped when
          // higher-precedence sources win.
          admin
            .from('org_members')
            .select('organization_id')
            .eq('user_id', user.id)
            .order('created_at', { ascending: true })
            .limit(1)
            .maybeSingle()
            .then((r) => r.data?.organization_id ?? null),
          // Onboarding completion. Cheap (PK lookup on user_profiles) and
          // unlocks the dashboard layout's `redirect('/onboarding')` guard.
          admin
            .from('user_profiles')
            .select('onboarded_at')
            .eq('user_id', user.id)
            .maybeSingle()
            .then((r) => !!r.data?.onboarded_at),
        ])

        // Precedence: explicit cookie pick > legacy app_metadata > oldest.
        orgId = preferredRow ?? appMetaOrg ?? oldestRow ?? undefined
        onboarded = profileRow
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
    '/((?!_next/static|_next/image|favicon.ico|api/|monitoring|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
