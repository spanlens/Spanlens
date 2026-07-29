import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Source guard: two hooks must never declare the same static queryKey.
 *
 * TanStack Query caches by key, so two `useQuery` declarations sharing a key
 * share one cache entry — the queryFn that resolves last wins and every
 * consumer gets that shape. `useCurrentUser` (a `CurrentUser` object) and the
 * old inline query inside `useCurrentMember` (an email string) both used
 * `['current-user']`, which crashed the whole /settings route with
 * "email.toLowerCase is not a function" whenever the object won the race.
 *
 * Only fully-static keys are checked: keys built from a helper or containing a
 * variable segment are scoped by that variable and can legitimately repeat.
 */

const QUERIES_DIR = join(__dirname)

/**
 * Captures the contents of a single-line `queryKey: [...]`. Deliberately one
 * flat character class rather than a repeated group of segments: a nested
 * quantifier here is an ReDoS shape (CodeQL js/redos) even though this only
 * ever reads our own source.
 */
const KEY_ARRAY = /queryKey:\s*\[([^\]\n]*)\]/
/** A key segment that is a plain string literal, e.g. `'current-user'`. */
const STRING_SEGMENT = /^'[^']*'$/

/**
 * Cache-management calls (`invalidateQueries`, `cancelQueries`,
 * `setQueriesData`, ...) reference keys other hooks own. Repeating a key there
 * is the point, so those lines are not declarations.
 */
const CACHE_CALL = /(invalidate|cancel|remove|refetch|reset|get|set)Quer(y|ies)/

function collectStaticKeys(): Map<string, string[]> {
  const found = new Map<string, string[]>()
  for (const file of readdirSync(QUERIES_DIR)) {
    if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue
    const lines = readFileSync(join(QUERIES_DIR, file), 'utf8').split('\n')
    lines.forEach((line, i) => {
      if (CACHE_CALL.test(line)) return
      const match = KEY_ARRAY.exec(line)
      if (!match) return
      const segments = match[1]!.split(',').map((s) => s.trim()).filter(Boolean)
      // A spread, helper call or variable segment means the key is scoped by
      // that value and may legitimately repeat, so it is not a static key.
      if (segments.length === 0) return
      if (!segments.every((s) => STRING_SEGMENT.test(s))) return
      const key = segments.map((s) => s.slice(1, -1)).join(' > ')
      const sites = found.get(key) ?? []
      sites.push(`${file}:${i + 1}`)
      found.set(key, sites)
    })
  }
  return found
}

describe('query key uniqueness', () => {
  const keys = collectStaticKeys()

  it('finds the static keys it is meant to guard', () => {
    expect(keys.size).toBeGreaterThan(3)
    expect(keys.has('current-user')).toBe(true)
  })

  it('declares every static query key exactly once', () => {
    const duplicates = [...keys.entries()].filter(([, sites]) => sites.length > 1)
    expect(
      duplicates.map(([key, sites]) => `['${key}'] declared at ${sites.join(', ')}`),
    ).toEqual([])
  })
})
