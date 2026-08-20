import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Source guard for `config.matcher` in middleware.ts.
 *
 * The matcher is an INCLUDE-list: it names the only paths that pay for an
 * Edge invocation of the Supabase session middleware. Everything else —
 * the ~139 statically prerendered marketing/docs routes — is served straight
 * from the CDN with no Edge hop. That shape is cheap but it introduces a
 * drift surface, which is what these tests exist to close.
 *
 * The chain the tests enforce, link by link:
 *
 *   app/(dashboard)/<route>/   →   PROTECTED_PATHS   →   config.matcher
 *          (guard 3)                    (guard 1)
 *
 * Guard 1 — every PROTECTED_PATHS entry matches the matcher, bare and as a
 *   sub-path. A prefix that made it into the array but not the literal
 *   matcher would silently stop getting `x-spanlens-*` headers.
 * Guard 2 — the auth-flow paths the middleware body branches on (`/login`,
 *   `/signup`) match.
 * Guard 3 — every directory under app/(dashboard)/ appears in
 *   PROTECTED_PATHS, read from the real filesystem at test time. This is the
 *   guard that actually catches drift: a brand-new dashboard route fails CI
 *   until it is registered, instead of quietly losing its session headers.
 * Guard 4 — representative public paths do NOT match, so a careless edit
 *   cannot reintroduce the Edge hop on the static surface, and cannot revert
 *   this to the old negative-lookahead form (which matched everything).
 * Guard 5 — the unauthenticated static/machine-readable surface AI crawlers
 *   poll (`/llms.txt`, `/AGENTS.md`, `/robots.txt`, `/sitemap.xml`, fonts,
 *   icons) stays unmatched, as it was under the old exclude-list.
 *
 * Note the failure mode this file protects against is the *benign* one: a
 * forgotten dashboard route loses its headers and (dashboard)/layout.tsx's
 * `!userId → redirect('/login')` catches it. The dangerous inverse — a public
 * page getting locked out, the #388 P0 — cannot happen here, because a page
 * missing from an include-list is simply never processed. See the matcher
 * comment in middleware.ts.
 *
 * Both PROTECTED_PATHS and the matcher are read from source rather than
 * imported: importing middleware.ts pulls in `next/server` and
 * `@supabase/ssr` for what are pure string assertions.
 */

const MIDDLEWARE_PATH = join(__dirname, '..', 'middleware.ts')
const DASHBOARD_DIR = join(__dirname, '..', 'app', '(dashboard)')

function matcherSource(): string {
  const source = readFileSync(MIDDLEWARE_PATH, 'utf8')
  const match = source.match(/matcher:\s*\[\s*'([^']+)'/)
  if (!match?.[1]) throw new Error('Could not find config.matcher in middleware.ts')
  // Reading the raw file gives us the *source* form of the string literal, so
  // every backslash is still doubled (`\\.` in the file is `\.` at runtime).
  // Collapse them back before compiling, or a pattern silently matches a
  // literal backslash instead of the character it meant.
  return match[1].replace(/\\\\/g, '\\')
}

function matcherRegex(): RegExp {
  // The matcher string is a path pattern Next compiles to a full-match regex.
  return new RegExp(`^${matcherSource()}$`)
}

/** PROTECTED_PATHS, parsed from middleware source (mirrors robots-groups.test.ts). */
function protectedPaths(): string[] {
  const source = readFileSync(MIDDLEWARE_PATH, 'utf8')
  const block = source.match(/const PROTECTED_PATHS = \[([\s\S]*?)\]/)
  if (!block?.[1]) throw new Error('Could not find PROTECTED_PATHS in middleware.ts')
  return [...block[1].matchAll(/'([^']+)'/g)].flatMap((m) => (m[1] ? [m[1]] : []))
}

/**
 * First URL segment of every route under app/(dashboard)/, read live so a
 * newly added route group shows up here the moment the directory exists.
 *
 * Next directory conventions that contribute NO URL segment are handled:
 *   • `(group)` — route group; descend into it and take what's underneath, so
 *     a future regrouping (e.g. `(dashboard)/(billing)/invoices`) cannot hide
 *     `/invoices` from this guard.
 *   • `_private` — excluded from routing entirely.
 *   • `@slot` — parallel route, rendered inside a sibling page's layout.
 *
 * A `[dynamic]` directory is deliberately NOT filtered out: it does own a URL
 * segment, and a static PROTECTED_PATHS prefix cannot express it. If one ever
 * appears the assertion below should fail loudly so the auth boundary gets
 * rethought rather than silently skipped.
 */
function dashboardRouteSegments(dir: string = DASHBOARD_DIR): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isDirectory()) return []
    if (entry.name.startsWith('(')) return dashboardRouteSegments(join(dir, entry.name))
    if (entry.name.startsWith('_') || entry.name.startsWith('@')) return []
    return [entry.name]
  })
}

/**
 * Auth-flow paths outside PROTECTED_PATHS that the middleware body still
 * branches on: `user && (path === '/login' || path === '/signup')` redirects
 * an already-signed-in visitor to /dashboard.
 */
const AUTH_FLOW_PATHS = ['/login', '/signup']

/** Extra protected paths worth asserting by hand — nested and dynamic shapes. */
const MUST_MATCH = ['/dashboard', '/requests/abc-123', '/settings/alerts', '/onboarding']

/**
 * Public pages that MUST NOT run the middleware. These are the statically
 * prerendered marketing/docs/share surface from #462 — the whole point of the
 * include-list. `/share/abc123` also pins the boundary against the protected
 * `/shares` dashboard route, which merely shares a string prefix.
 */
const MUST_NOT_MATCH_PUBLIC = [
  '/',
  '/pricing',
  '/docs/quick-start',
  '/compare/langfuse',
  '/changelog',
  '/share/abc123',
  '/about',
  '/blog-that-does-not-exist-yet',
  '/invite',
  '/auth/callback',
]

/** Unauthenticated static surface that must stay off the Edge, as before. */
const MUST_NOT_MATCH_STATIC = [
  '/llms.txt',
  '/llms-full.txt',
  '/AGENTS.md',
  '/pricing.md',
  '/robots.txt',
  '/sitemap.xml',
  '/favicon.ico',
  '/icon.png',
  '/apple-icon.png',
  '/og.webp',
  '/site.webmanifest',
  '/fonts/inter.woff2',
  '/api/v1/stats',
  '/monitoring',
  '/_next/static/chunks/main.js',
]

describe('middleware matcher', () => {
  const re = matcherRegex()

  // Guard 1.
  it.each(protectedPaths())('runs middleware for protected path %s', (path) => {
    expect(
      re.test(path),
      `"${path}" is in PROTECTED_PATHS but does not match config.matcher — the ` +
        'middleware would never run, so the /login redirect and the ' +
        'x-spanlens-* headers are both lost. Add it to the matcher alternation.',
    ).toBe(true)
    // Boundary-aware sub-path coverage: `/settings` must also cover
    // `/settings/alerts`, mirroring the `path.startsWith(base + '/')` check.
    expect(
      re.test(`${path}/nested/deep`),
      `"${path}" matches but "${path}/nested/deep" does not — the matcher is ` +
        'missing its sub-path suffix, so only the index page is protected.',
    ).toBe(true)
  })

  // Guard 2.
  it.each(AUTH_FLOW_PATHS)('runs middleware for auth-flow path %s', (path) => {
    expect(
      re.test(path),
      `"${path}" must match: the middleware redirects an authenticated user ` +
        'from it to /dashboard. Unmatched, they would see the auth form instead.',
    ).toBe(true)
  })

  it.each(MUST_MATCH)('runs middleware for %s', (path) => {
    expect(re.test(path)).toBe(true)
  })

  // Guard 3 — the one that actually prevents drift.
  it.each(dashboardRouteSegments())(
    'app/(dashboard)/%s is registered in PROTECTED_PATHS',
    (segment) => {
      expect(
        protectedPaths(),
        `app/(dashboard)/${segment}/ exists but "/${segment}" is not in ` +
          'PROTECTED_PATHS in middleware.ts. Add it there AND to the ' +
          'config.matcher alternation, otherwise the route never receives the ' +
          'x-spanlens-* auth headers and (dashboard)/layout.tsx bounces every ' +
          'visitor — signed in or not — to /login.',
      ).toContain(`/${segment}`)
    },
  )

  // Guard 4.
  it.each(MUST_NOT_MATCH_PUBLIC)('skips middleware for public page %s', (path) => {
    expect(
      re.test(path),
      `"${path}" is public and statically prerendered — matching it puts an ` +
        'Edge invocation and a supabase.auth.getUser() round-trip in front of ' +
        'a CDN cache HIT. The matcher must be an include-list, not a negative ' +
        'lookahead.',
    ).toBe(false)
  })

  // Guard 5.
  it.each(MUST_NOT_MATCH_STATIC)('skips middleware for static asset %s', (path) => {
    expect(re.test(path)).toBe(false)
  })

  it('carries no file-extension exemptions (the include-list makes them dead weight)', () => {
    // The old exclude-list had to enumerate `svg|png|…|json`-shaped exemptions
    // and a stray `.json` would have exempted a future protected route. An
    // include-list needs none of that; if one reappears the matcher has been
    // reverted to the exclude-list shape.
    expect(matcherSource()).not.toContain('json')
    expect(matcherSource()).not.toContain('webmanifest')
  })
})
