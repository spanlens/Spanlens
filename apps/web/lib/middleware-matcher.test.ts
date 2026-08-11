import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Source guard for the `config.matcher` regex in middleware.ts.
 *
 * The matcher decides which requests pay for an Edge invocation of the Supabase
 * session middleware. Two failure modes it protects against:
 *
 *  1. Too narrow — a protected dashboard route stops matching, so the auth
 *     redirect never runs. (The (dashboard) layout's own `!userId → /login`
 *     check is the second line of defence, but losing the first one silently
 *     is still bad.)
 *  2. Too wide — unauthenticated machine-readable assets (`/llms.txt`,
 *     `/AGENTS.md`, `/robots.txt`, `/sitemap.xml`, fonts, icons) match again,
 *     putting an Edge hop in front of responses the CDN should serve directly.
 *     AI crawlers poll these constantly, so the invocation cost is real.
 *
 * The regex is read from source rather than imported because importing
 * middleware.ts pulls in `next/server` and `@supabase/ssr` for what is a pure
 * string assertion.
 */

const MIDDLEWARE_PATH = join(__dirname, '..', 'middleware.ts')

function matcherSource(): string {
  const source = readFileSync(MIDDLEWARE_PATH, 'utf8')
  const match = source.match(/matcher:\s*\[\s*'([^']+)'/)
  if (!match?.[1]) throw new Error('Could not find config.matcher in middleware.ts')
  // Reading the raw file gives us the *source* form of the string literal, so
  // every backslash is still doubled (`\\.` in the file is `\.` at runtime).
  // Collapse them back before compiling, or the extension exclusions silently
  // match a literal backslash instead of a dot and every asset path "matches".
  return match[1].replace(/\\\\/g, '\\')
}

function matcherRegex(): RegExp {
  // The matcher string is a path pattern Next compiles to a full-match regex.
  return new RegExp(`^${matcherSource()}$`)
}

/** Paths that MUST run the middleware — auth depends on it. */
const MUST_MATCH = [
  '/dashboard',
  '/requests',
  '/requests/abc-123',
  '/settings/alerts',
  '/onboarding',
  '/login',
  '/signup',
  '/',
  '/pricing',
  '/docs/quick-start',
]

/** Paths that MUST NOT run the middleware — unauthenticated static surface. */
const MUST_NOT_MATCH = [
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
  '/_next/static/chunks/main.js',
]

describe('middleware matcher', () => {
  const re = matcherRegex()

  it.each(MUST_MATCH)('runs middleware for %s', (path) => {
    expect(re.test(path)).toBe(true)
  })

  it.each(MUST_NOT_MATCH)('skips middleware for %s', (path) => {
    expect(re.test(path)).toBe(false)
  })

  it('never exempts a .json path (a future protected route could end in .json)', () => {
    expect(matcherSource()).not.toContain('json')
  })
})
