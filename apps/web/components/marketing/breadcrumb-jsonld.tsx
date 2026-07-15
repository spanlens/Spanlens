const SITE_URL = 'https://www.spanlens.io'

interface Crumb {
  /** Human-readable label shown in the SERP breadcrumb trail. */
  name: string
  /** Path appended to SITE_URL, e.g. '/pricing'. */
  path: string
}

/**
 * BreadcrumbList JSON-LD for top-level marketing / content / legal pages.
 * Docs pages get their breadcrumb from DocsJsonLd instead; this covers the
 * flat one-level marketing routes (Home → <page>) that previously carried
 * only the inherited Organization + WebSite nodes (2026-07-15 schema
 * follow-up). Home is prepended automatically, so callers pass only the
 * page's own crumb(s):
 *
 *   <BreadcrumbJsonLd trail={[{ name: 'Pricing', path: '/pricing' }]} />
 */
export function BreadcrumbJsonLd({ trail }: { trail: Crumb[] }) {
  const items: Crumb[] = [{ name: 'Home', path: '' }, ...trail]

  const payload = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((crumb, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: crumb.name,
      item: `${SITE_URL}${crumb.path}`,
    })),
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(payload) }}
    />
  )
}
