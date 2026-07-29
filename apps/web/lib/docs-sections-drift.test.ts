import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DOCS_SECTIONS } from '@/app/docs/_lib/sections'

/**
 * Drift guard for the six /docs/<section> hub pages.
 *
 * The hub pages restate every child page's title and description so the
 * section reads as real content rather than a bare link list. That copy is a
 * second home for strings whose source of truth is each page's own
 * `export const metadata`, so it can silently rot: a page gets reworded, or a
 * new page is added under a section directory and never appears on the hub.
 *
 * The section paths themselves are the reason this exists. All six returned
 * 404 until 2026-07-29 (Search Console logged /docs/features as "Not found"),
 * because every docs page lives one level deeper and no section had an index.
 *
 * If this test fails: re-copy the child page's `title` / `description` into
 * app/docs/_lib/sections.ts, or add the missing page to the right group.
 */

const APP_DIR = join(__dirname, '..', 'app')
const DOCS_DIR = join(APP_DIR, 'docs')

const TITLE_RE = /title:\s*'((?:[^'\\]|\\.)*)'/
const DESCRIPTION_RE = /description:\s*\n?\s*'((?:[^'\\]|\\.)*)'/

function pageSource(href: string): string {
  const file = join(APP_DIR, ...href.split('/').filter(Boolean), 'page.tsx')
  expect(existsSync(file), `${href} has no page.tsx`).toBe(true)
  return readFileSync(file, 'utf-8')
}

/** Child directories under a section that actually hold a page. */
function childSlugs(slug: string): string[] {
  const dir = join(DOCS_DIR, slug)
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(dir, e.name, 'page.tsx')))
    .map((e) => e.name)
}

describe.each(DOCS_SECTIONS.map((s) => [s.slug, s] as const))('/docs/%s', (slug, section) => {
  const listed = section.groups.flatMap((g) => g.pages)

  it('has a hub page of its own', () => {
    const source = pageSource(`/docs/${slug}`)
    expect(source).toContain(`canonical: '/docs/${slug}'`)
  })

  it('keeps the meta description under 160 characters', () => {
    // Google truncates around here, and Ahrefs Site Audit flags anything
    // longer as "Meta description too long".
    expect(section.description.length).toBeLessThanOrEqual(160)
  })

  it('lists every child page exactly once', () => {
    const hrefs = listed.map((p) => p.href).sort()
    const expected = childSlugs(slug)
      .map((child) => `/docs/${slug}/${child}`)
      .sort()
    expect(hrefs).toEqual(expected)
  })

  it.each(listed.map((p) => [p.href, p] as const))('%s matches the page metadata', (href, page) => {
    const source = pageSource(href)
    const title = source.match(TITLE_RE)?.[1]
    const description = source.match(DESCRIPTION_RE)?.[1]

    expect(title, `no title in ${href}`).toBeTruthy()
    expect(description, `no description in ${href}`).toBeTruthy()

    // Page titles carry a "· Spanlens Docs" suffix the hub card drops.
    expect(page.title).toBe(title?.split('·')[0]?.trim())
    expect(page.description).toBe(description)
  })
})

describe('sitemap', () => {
  const source = readFileSync(join(APP_DIR, 'sitemap.ts'), 'utf-8')

  it.each(DOCS_SECTIONS.map((s) => s.slug))('includes /docs/%s', (slug) => {
    expect(source).toContain(`'/docs/${slug}',`)
  })
})
