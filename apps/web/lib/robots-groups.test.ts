import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import robots from '@/app/robots'

/**
 * Guards the robots.txt user-agent grouping rule.
 *
 * Per the robots.txt spec a crawler obeys ONLY the single most-specific
 * user-agent group that matches it; named groups do NOT inherit rules from the
 * `*` group. The AI-crawler groups used to be declared as
 * `{ userAgent: 'GPTBot', allow: '/' }` with no disallow list at all, so every
 * one of them was explicitly permitted to crawl /api/, /dashboard, /admin and
 * /share/<token> — paths the `*` group closes. This test fails the moment a
 * new group is added without the shared disallow list, or an existing group
 * drifts away from it.
 *
 * Lives in lib/ rather than next to app/robots.ts because vitest.config.ts's
 * `include` globs only cover lib/** and components/** — a test under app/**
 * would be silently skipped.
 */

type RobotsRule = {
  userAgent?: string | string[] | undefined
  allow?: string | string[] | undefined
  disallow?: string | string[] | undefined
  crawlDelay?: number | undefined
}

const toList = (value: string | string[] | undefined): string[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value]

const { rules } = robots()
const groups: RobotsRule[] = Array.isArray(rules) ? rules : [rules]

const wildcard = groups.find((group) => group.userAgent === '*')
const namedGroups = groups.filter((group) => group.userAgent !== '*')
const wildcardDisallow = toList(wildcard?.disallow)

describe('robots.txt — every user-agent group carries the same disallow list', () => {
  it('declares a wildcard group with a non-empty disallow list', () => {
    expect(wildcard, 'no `*` group found in app/robots.ts').toBeDefined()
    expect(wildcardDisallow.length).toBeGreaterThan(0)
  })

  it('declares at least one named crawler group', () => {
    // Without named groups the parity assertion below would pass vacuously.
    expect(namedGroups.length).toBeGreaterThan(0)
  })

  it.each(namedGroups.map((group) => [String(group.userAgent), group] as const))(
    '%s inherits every disallowed path from the `*` group',
    (userAgent, group) => {
      const actual = toList(group.disallow)

      for (const path of wildcardDisallow) {
        expect(
          actual,
          `${userAgent} is missing "${path}" — named robots.txt groups do not ` +
            'inherit from "*", so this crawler is currently allowed to fetch it',
        ).toContain(path)
      }
    },
  )

  it.each(namedGroups.map((group) => [String(group.userAgent), group] as const))(
    '%s keeps its explicit `allow: /` opt-in',
    (userAgent, group) => {
      // The allow is the deliberate signal that AI crawlers are welcome on
      // public content. Dropping it while keeping the disallow list would read
      // as a partial block to bots that treat a named group as authoritative.
      expect(toList(group.allow), `${userAgent} lost its allow rule`).toContain('/')
    },
  )

  it.each([['/share/'], ['/dashboard'], ['/admin'], ['/api/']])(
    'closes %s to every group, named and wildcard',
    (path) => {
      for (const group of groups) {
        expect(
          toList(group.disallow),
          `${String(group.userAgent)} may crawl ${path}`,
        ).toContain(path)
      }
    },
  )
})

/**
 * Drift guard between middleware.ts's PROTECTED_PATHS and the robots disallow
 * list, and a trailing-slash trap guard.
 *
 * A rule written as `Disallow: /onboarding/` matches only paths that START WITH
 * `/onboarding/`. The route that actually exists is the bare `/onboarding`, so
 * that rule left it crawlable and crawlers kept following it into the 307 to
 * /login. `/invite` had the identical bug. Asserting `path.startsWith(rule)`
 * rather than `list.includes(path)` is what catches the trailing slash: the
 * bare path cannot start with the slashed prefix.
 *
 * PROTECTED_PATHS is read from middleware source rather than imported because
 * importing middleware.ts pulls in next/server and @supabase/ssr for what is a
 * pure string comparison.
 */
const MIDDLEWARE_PATH = join(__dirname, '..', 'middleware.ts')

function protectedPaths(): string[] {
  const source = readFileSync(MIDDLEWARE_PATH, 'utf8')
  const block = source.match(/const PROTECTED_PATHS = \[([\s\S]*?)\]/)
  if (!block?.[1]) throw new Error('Could not find PROTECTED_PATHS in middleware.ts')
  return [...block[1].matchAll(/'([^']+)'/g)].flatMap((m) => (m[1] ? [m[1]] : []))
}

describe('robots.txt — auth-gated routes are actually blocked', () => {
  it.each(protectedPaths().map((path) => [path] as const))(
    '%s is covered by a disallow rule that matches the bare path',
    (path) => {
      const covering = wildcardDisallow.filter((rule) => path.startsWith(rule))
      expect(
        covering,
        `no robots.txt rule matches "${path}". A rule like "${path}/" does NOT ` +
          'match the bare path — drop the trailing slash.',
      ).not.toHaveLength(0)
    },
  )
})
