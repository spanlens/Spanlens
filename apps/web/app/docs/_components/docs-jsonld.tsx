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
 * The breadcrumb is intentionally a uniform Home → Docs → page trail: most
 * docs sections (/docs/concepts, /docs/features, …) have no index page, so
 * deeper trails would point crawlers at 404s.
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

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
      { '@type': 'ListItem', position: 2, name: 'Docs', item: `${SITE_URL}/docs` },
      { '@type': 'ListItem', position: 3, name: shortTitle, item: url },
    ],
  }

  const articleJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    '@id': `${url}#article`,
    headline: meta.title,
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
