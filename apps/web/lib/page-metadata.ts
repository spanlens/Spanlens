import type { Metadata } from 'next'

const SITE_NAME = 'Spanlens'
const LOCALE = 'en_US'

/**
 * The card from app/opengraph-image.tsx, referenced explicitly.
 *
 * That file convention only reaches pages that inherit the root layout's
 * `openGraph` block. The moment a page declares its own, the generated image
 * goes with the rest of the inherited block, and the page ships without an
 * `og:image` — which is what Ahrefs reports as "Open Graph tags incomplete".
 * `twitter:image` is unaffected because no page overrides `twitter`.
 */
export const OG_IMAGE = [
  { url: '/opengraph-image', width: 1200, height: 630, alt: SITE_NAME },
]

/**
 * Open Graph block for a page, keyed on the same path as its canonical.
 *
 * Two constraints make this a helper rather than a literal on each page:
 *
 *  - Next.js merges `openGraph` wholesale. A page that declares the block to
 *    set `url` drops the `type` / `siteName` / `locale` it would otherwise
 *    inherit from the root layout, which is how 19 pages ended up flagged as
 *    "Open Graph tags incomplete" before this existed.
 *  - The root layout deliberately sets no `url`, `title`, or `description`,
 *    because every page without its own block inherits them verbatim. That
 *    shipped twice: a root canonical de-indexed 61 pages (2026-06-11), and a
 *    root `openGraph.url` gave 77 pages the homepage card (2026-07-29).
 *
 * `title` and `description` stay out on purpose. Next.js falls back to the
 * page's own `title` / `description` when the Open Graph block omits them, so
 * repeating them here would just be a second copy to keep in sync.
 *
 * `page-metadata.test.ts` checks every page's `openGraph.url` against its
 * canonical.
 */
export function openGraphFor(
  path: string,
  options?: { type?: 'website' | 'article' },
): Metadata['openGraph'] {
  return {
    type: options?.type ?? 'website',
    siteName: SITE_NAME,
    locale: LOCALE,
    url: path,
    images: OG_IMAGE,
  }
}
