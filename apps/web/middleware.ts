import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * Session validation + auth redirects.
 *
 * Runs only on the auth-relevant surface — the `(dashboard)` route group,
 * `/onboarding`, `/login` and `/signup` (see `config.matcher` at the bottom
 * of this file). Validates the Supabase session via `getUser()`, then
 * forwards `x-spanlens-user-id` / `x-spanlens-org-id` request headers
 * downstream so the dashboard layout does NOT need to re-call `getUser()` —
 * one round-trip per navigation instead of two.
 */

/**
 * Auth-gated route prefixes. Everything else is public by default.
 *
 * WHY a protected list instead of a public list: the site is overwhelmingly
 * public (marketing, docs, changelog, compare, share viewer, SEO tool pages —
 * and new ones ship weekly), while the protected surface is the stable
 * (dashboard) route group + /onboarding. An allow-list of public paths rots:
 * the moment the isPublic boundary check was fixed (#388), every public page
 * missing from the list started 307-ing anonymous visitors to /login
 * (docs, changelog, share links, all comparison pages — live P0).
 *
 * Defense in depth: (dashboard)/layout.tsx independently redirects to /login
 * when the x-spanlens-user-id header is absent, so a new dashboard route
 * forgotten here still cannot render for an anonymous user.
 *
 * Keep in sync with apps/web/app/(dashboard)/* directories + /onboarding,
 * AND with `config.matcher` at the bottom of this file — the matcher is an
 * include-list built from these same prefixes, and Next needs it spelled out
 * as a literal. `lib/middleware-matcher.test.ts` enforces both directions.
 */
const PROTECTED_PATHS = [
  '/admin',
  '/alerts',
  '/annotation',
  '/anomalies',
  '/billing',
  '/dashboard',
  '/datasets',
  '/evals',
  '/experiments',
  '/onboarding',
  '/projects',
  '/prompts',
  '/requests',
  '/savings',
  '/security',
  '/sessions',
  '/settings',
  '/shares',
  '/traces',
  '/users',
]

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
  // Boundary-aware path-segment prefix match: `/settings` covers `/settings/x`
  // but `/shares` (protected dashboard page) never accidentally captures the
  // public `/share/<token>` viewer that merely shares the string prefix.
  const isProtected = PROTECTED_PATHS.some(
    (base) => path === base || path.startsWith(base + '/'),
  )

  // getUser() may have rotated the Supabase session mid-request. The rotated
  // cookies were written onto `supabaseResponse` — EVERY response object this
  // middleware returns (redirects included) must carry them, or the browser
  // keeps replaying the stale refresh token, trips Supabase reuse detection,
  // and the user gets randomly logged out. #388 fixed this for the final
  // pass-through response only; the redirect branches had the same bug.
  const withRotatedCookies = (res: NextResponse): NextResponse => {
    for (const cookie of supabaseResponse.cookies.getAll()) {
      res.cookies.set(cookie)
    }
    return res
  }

  if (!user && isProtected) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return withRotatedCookies(NextResponse.redirect(url))
  }

  if (user && (path === '/login' || path === '/signup')) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return withRotatedCookies(NextResponse.redirect(url))
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

    // getUser() may have rotated the Supabase session; setAll() wrote the fresh
    // cookies onto request.cookies (for THIS request's SSR) and onto the old
    // supabaseResponse (for the browser). Sync the rotated cookies into the
    // downstream request header so RSC forwards the fresh token to the API.
    requestHeaders.set('cookie', request.cookies.toString())

    // Re-materialize the response with the updated headers so downstream RSC
    // (notably (dashboard)/layout.tsx) sees them via next/headers.
    const finalResponse = NextResponse.next({
      request: { headers: requestHeaders },
    })
    // CRITICAL: carry over any auth cookies the Supabase client rotated during
    // getUser(). Creating a fresh NextResponse here would otherwise DROP the
    // refreshed session cookies set on supabaseResponse — the browser would
    // then keep replaying the old refresh token, tripping Supabase reuse
    // detection and randomly logging the user out.
    for (const cookie of supabaseResponse.cookies.getAll()) {
      finalResponse.cookies.set(cookie)
    }
    supabaseResponse = finalResponse
  }

  return supabaseResponse
}

/**
 * INCLUDE-list matcher: the middleware runs ONLY on the paths enumerated
 * below. Contents = every entry in PROTECTED_PATHS, plus `/login` and
 * `/signup`.
 *
 * Why it flipped from an exclude-list. The previous matcher was a negative
 * lookahead that only skipped static-asset extensions, so it matched every
 * marketing and docs URL. Since #462 those ~139 routes are statically
 * prerendered and served from the CDN with `X-Vercel-Cache: HIT` — but the
 * matcher still put an Edge invocation plus a `supabase.auth.getUser()`
 * round-trip in front of each one, for a response the CDN already had and a
 * session no anonymous marketing reader has. None of those pages read an
 * `x-spanlens-*` header or sit behind `isProtected`, so the work was pure
 * overhead on the hottest paths on the site.
 *
 * Why this is NOT a rerun of the #388 P0 (see the PROTECTED_PATHS comment).
 * That incident was a *public* allow-list consulted INSIDE the middleware
 * body: a public page missing from it fell into the protected branch and
 * 307'd anonymous visitors to /login. This list instead decides whether the
 * middleware runs at all, so the failure mode inverts:
 *   • forgotten PUBLIC page  → never matched → served straight from the CDN.
 *     That is the intended outcome, not a lockout.
 *   • forgotten DASHBOARD route → no `x-spanlens-*` headers → (dashboard)/
 *     layout.tsx's `!userId → redirect('/login')` fires. Fail-closed, and
 *     `lib/middleware-matcher.test.ts` fails CI first (see below).
 *
 * Why each group is here:
 *   • PROTECTED_PATHS entries — the `!user && isProtected → /login` redirect
 *     and the `x-spanlens-user-id` / `-org-id` / `-onboarded` header
 *     forwarding both live behind them.
 *   • `/login`, `/signup` — the `user && (path === '/login' || path ===
 *     '/signup') → /dashboard` branch. Without a match an already-signed-in
 *     user would land on the login form instead of the dashboard.
 *
 * Why nothing else is here. `/auth/callback` is a route handler that builds
 * its own `createServerClient` and calls `exchangeCodeForSession`, writing
 * the session cookies onto its own response — a middleware `getUser()` in
 * front of it finds no session yet, triggers no branch, and is discarded.
 * `/auth/device`, `/auth/mfa`, `/auth/locked`, `/invite`, `/verify-email`,
 * `/reset-password` and `/forgot-password` are all `'use client'` pages that
 * talk to Supabase from the browser. None read an `x-spanlens-*` header and
 * none appear in a branch above.
 *
 * MUST stay in sync with PROTECTED_PATHS. Next requires matcher values to be
 * statically analyzable literals, so this cannot be derived from the array at
 * build time — `lib/middleware-matcher.test.ts` is the enforcement. It parses
 * both out of this file and fails when they diverge, and separately fails
 * when a directory under `app/(dashboard)/` is missing from PROTECTED_PATHS.
 */
export const config = {
  matcher: [
    '/((?:admin|alerts|annotation|anomalies|billing|dashboard|datasets|evals|experiments|login|onboarding|projects|prompts|requests|savings|security|sessions|settings|shares|signup|traces|users)(?:/.*)?)',
  ],
}
