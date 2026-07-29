import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Source guard: the root layout must not declare page-specific metadata.
 *
 * Next.js merges metadata shallowly. A child page that declares no
 * `openGraph` (or `twitter`, or `alternates`) inherits the root layout's copy
 * verbatim, so any page-specific value at the root silently becomes the value
 * on every page that doesn't override it.
 *
 * This has now bitten twice:
 *
 *  - 2026-06-11: a root `alternates.canonical` of '/' canonicalised the whole
 *    site to the homepage. 61 pages (76%) fell out of the index.
 *  - 2026-07-29: a root `openGraph.url` / `title` / `description` gave 77
 *    pages the homepage's Open Graph card, complete with the homepage URL
 *    (Ahrefs: "Open Graph URL not matching canonical", 77 pages).
 *
 * Omitting these fields at the root is what makes the fallback work: Next.js
 * derives `og:title` / `og:description` (and the twitter equivalents) from the
 * page's own `title` / `description` when the Open Graph block doesn't set
 * them, so each page gets a correct card with no per-page boilerplate.
 *
 * `type`, `siteName`, and `locale` are safe to keep at the root: they are the
 * same on every page.
 */

const LAYOUT = join(__dirname, '..', 'app', 'layout.tsx')

/** Extract a top-level metadata block (e.g. `openGraph: { ... }`) by brace matching. */
function metadataBlock(source: string, key: string): string {
  const start = source.indexOf(`  ${key}: {`)
  if (start === -1) return ''
  let depth = 0
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++
    if (source[i] === '}') {
      depth--
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  return ''
}

describe('root layout metadata', () => {
  const source = readFileSync(LAYOUT, 'utf-8')

  it('declares no site-wide canonical', () => {
    // A root canonical is inherited by every page that omits `alternates`.
    expect(source).not.toMatch(/^\s{2}alternates:/m)
  })

  it.each(['openGraph', 'twitter'] as const)(
    'declares no page-specific fields in %s',
    (key) => {
      const block = metadataBlock(source, key)
      expect(block, `${key} block not found in app/layout.tsx`).not.toBe('')

      for (const field of ['url', 'title', 'description']) {
        expect(
          new RegExp(`^\\s+${field}:`, 'm').test(block),
          `app/layout.tsx sets \`${key}.${field}\`, which every page without its own ` +
            `\`${key}\` block inherits. Remove it and let the page's own metadata supply it.`,
        ).toBe(false)
      }
    },
  )
})
