import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Every page that declares a canonical must also declare a matching Open
 * Graph URL.
 *
 * The root layout deliberately sets no `openGraph.url`, because Next.js
 * merges the block wholesale and every page without its own would inherit the
 * homepage URL verbatim — which is exactly what happened to 77 pages until
 * 2026-07-29. Removing it fixed the wrong URLs and left those pages with no
 * `og:url` at all, which Ahrefs then reported as "Open Graph tags incomplete"
 * on 96 pages.
 *
 * `openGraphFor()` in lib/page-metadata.ts is the fix for both: it builds the
 * whole block from the canonical path, so `type` / `siteName` / `locale`
 * survive the wholesale merge. This test pins the invariant that made the
 * original bug possible: canonical and og:url must name the same URL.
 *
 * Pages with a `generateMetadata` function instead of a static object are out
 * of scope — their canonical is computed per request.
 */

const APP_DIR = join(__dirname, '..', 'app')

const CANONICAL_RE = /alternates:\s*\{\s*canonical:\s*'([^']+)'\s*\}/
const OG_HELPER_RE = /openGraph:\s*openGraphFor\(\s*'([^']+)'/

/**
 * Body of the `openGraph: { … }` literal, by brace matching.
 *
 * Not a regex: the first version of this test ended the block at the first
 * `\n  },`, and /about had lost the newline before its closing brace
 * (`url: '/about',  },`). The match ran past the real end into the next
 * property, picked up its keys, and the page passed while shipping without
 * og:image or og:locale.
 */
function openGraphBody(source: string): string | null {
  const start = source.indexOf('openGraph: {')
  if (start === -1) return null
  const open = source.indexOf('{', start)
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') {
      depth--
      if (depth === 0) return source.slice(open + 1, i)
    }
  }
  return null
}

function pageFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) pageFiles(full, out)
    else if (entry.name === 'page.tsx') out.push(full)
  }
  return out
}

const DESCRIPTION_RE = /description:\s*\n?\s*'((?:[^'\\]|\\.)*)'/
const DESCRIPTION_REF_RE = /description:\s*([A-Z_][A-Z0-9_]*),/

/** The page's own meta description, following a `const` reference if used. */
function description(source: string): string | null {
  const literal = source.match(DESCRIPTION_RE)?.[1]
  if (literal) return literal
  const ref = source.match(DESCRIPTION_REF_RE)?.[1]
  if (!ref) return null
  return new RegExp(`const ${ref}\\s*=\\s*\\n?\\s*'((?:[^'\\\\]|\\\\.)*)'`).exec(source)?.[1] ?? null
}

const pages = pageFiles(APP_DIR)
  .map((file) => ({ file, source: readFileSync(file, 'utf-8') }))
  .map((p) => ({ ...p, canonical: p.source.match(CANONICAL_RE)?.[1] }))
  .filter((p): p is typeof p & { canonical: string } => Boolean(p.canonical))
  .map((p) => ({ ...p, name: relative(APP_DIR, p.file).split(sep).join('/') }))

describe('page metadata', () => {
  it('finds the marketing and docs pages', () => {
    // Guards against the glob silently matching nothing after a move.
    expect(pages.length).toBeGreaterThan(80)
  })

  it.each(pages.map((p) => [p.name, p] as const))(
    '%s declares an og:url matching its canonical',
    (_name, page) => {
      const viaHelper = page.source.match(OG_HELPER_RE)
      if (viaHelper) {
        expect(viaHelper[1]).toBe(page.canonical)
        return
      }

      const literal = openGraphBody(page.source)
      expect(
        literal,
        `${page.name} declares a canonical but no openGraph block. Add openGraph: openGraphFor('${page.canonical}').`,
      ).toBeTruthy()

      const body = literal ?? ''
      expect(body.match(/url:\s*'([^']+)'/)?.[1]).toBe(page.canonical)
      // A hand-written block replaces the root's, so it has to repeat these.
      expect(body, `${page.name} openGraph is missing siteName`).toMatch(/siteName:/)
      expect(body, `${page.name} openGraph is missing locale`).toMatch(/locale:/)
      // Including the card: app/opengraph-image.tsx only reaches pages that
      // inherit the root block, so declaring one drops og:image with it.
      expect(body, `${page.name} openGraph is missing images`).toMatch(/images:/)
    },
  )
})

/**
 * Meta description length.
 *
 * Google truncates a description somewhere past 160 characters and tends to
 * substitute its own snippet when one is too thin to be useful. Ahrefs flags
 * both ends, and seven pages were outside the range on 2026-07-30.
 */
describe('meta description length', () => {
  const withText = pages
    .map((p) => ({ ...p, text: description(p.source) }))
    .filter((p): p is typeof p & { text: string } => p.text !== null)

  it.each(withText.map((p) => [p.name, p] as const))('%s is 110-160 characters', (_name, page) => {
    expect(page.text.length, `"${page.text}"`).toBeGreaterThanOrEqual(110)
    expect(page.text.length, `"${page.text}"`).toBeLessThanOrEqual(160)
  })

  it('only the section hubs build their description from a variable', () => {
    // Those six read `SECTION.description`, which sections.test.ts bounds.
    // Anything else unresolvable here would be skipped silently above.
    const unresolved = pages.filter((p) => description(p.source) === null).map((p) => p.name).sort()
    expect(unresolved).toEqual([
      'docs/concepts/page.tsx',
      'docs/features/page.tsx',
      'docs/integrations/page.tsx',
      'docs/migrate/page.tsx',
      'docs/production/page.tsx',
      'docs/tutorials/page.tsx',
    ])
  })
})
