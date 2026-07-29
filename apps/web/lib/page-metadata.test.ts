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
const OG_LITERAL_RE = /openGraph:\s*\{([\s\S]*?)\n\s*\},/

function pageFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) pageFiles(full, out)
    else if (entry.name === 'page.tsx') out.push(full)
  }
  return out
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

      const literal = page.source.match(OG_LITERAL_RE)
      expect(
        literal,
        `${page.name} declares a canonical but no openGraph block. Add openGraph: openGraphFor('${page.canonical}').`,
      ).toBeTruthy()

      const body = literal?.[1] ?? ''
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
