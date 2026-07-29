import { findDocsSection } from '@/app/docs/_lib/sections'

const SITE_URL = 'https://www.spanlens.io'

/**
 * Shape of the plain `export const metadata` object every docs page already
 * declares. Structurally compatible — pages pass their own metadata object
 * so title / description / canonical are never duplicated.
 */
interface DocsPageMeta {
  title?: string
  description?: string
  alternates?: { canonical?: string }
}

/**
 * BreadcrumbList + TechArticle JSON-LD for docs pages (2026-07-06 schema
 * audit: all 60 docs pages carried only the inherited Organization node).
 * Usage — first child of the page's root element:
 *
 *   <DocsJsonLd meta={metadata} />
 *
 * The breadcrumb inserts a section crumb (Home → Docs → Features → page) when
 * the page sits under one of the six sections that now have a hub page. It
 * used to be a flat Home → Docs → page trail because those section paths
 * returned 404 and a deeper trail would have pointed crawlers at them.
 *
 * Renders nothing if the page metadata is missing a canonical or title —
 * docs routes are server-rendered on demand, so throwing here would turn a
 * metadata omission into a runtime 500 instead of a missing schema block.
 */
export function DocsJsonLd({ meta }: { meta: DocsPageMeta }) {
  const canonical = meta.alternates?.canonical
  if (!canonical || !meta.title) return null

  const url = `${SITE_URL}${canonical}`
  // "Quick start · Spanlens Docs" → "Quick start" for the breadcrumb label.
  const shortTitle = meta.title.split('·')[0]?.trim() ?? meta.title

  // '/docs/features/evals' → 'features'. Undefined for '/docs' itself and for
  // pages that sit directly under /docs (e.g. '/docs/quick-start'), which have
  // no section to insert.
  const sectionSlug = canonical.split('/')[2]
  const section = canonical.split('/').length > 3 && sectionSlug ? findDocsSection(sectionSlug) : undefined

  const trail = [
    { name: 'Home', item: SITE_URL },
    { name: 'Docs', item: `${SITE_URL}/docs` },
    ...(section ? [{ name: section.title, item: `${SITE_URL}/docs/${section.slug}` }] : []),
    { name: shortTitle, item: url },
  ]

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((crumb, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: crumb.name,
      item: crumb.item,
    })),
  }

  const articleJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    '@id': `${url}#article`,
    headline: meta.title,
    datePublished: '2026-06-16',
    dateModified: '2026-07-24',
    url,
    ...(meta.description ? { description: meta.description } : {}),
    inLanguage: 'en',
    publisher: { '@id': `${SITE_URL}/#organization` },
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }}
      />
    </>
  )
}
