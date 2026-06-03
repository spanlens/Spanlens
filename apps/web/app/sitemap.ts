import type { MetadataRoute } from 'next'

const SITE_URL = 'https://www.spanlens.io'

const MARKETING_ROUTES = [
  '',
  '/pricing',
  '/alternatives',
  '/compare',
  '/compare/langfuse',
  '/compare/helicone',
  '/compare/langsmith',
  '/compare/braintrust',
  '/compare/arize-phoenix',
] as const

const MIGRATION_ROUTES = [
  '/docs/migrate/from-langfuse',
  '/docs/migrate/from-helicone',
  '/docs/migrate/from-langsmith',
] as const

const DOCS_ROUTES = [
  '/docs',
  '/docs/quick-start',
  '/docs/sdk',
  '/docs/proxy',
  '/docs/otel',
  '/docs/self-host',
  '/docs/why',
  '/docs/api',
  '/docs/features',
  '/docs/features/requests',
  '/docs/features/traces',
  '/docs/features/prompts',
  '/docs/features/prompts-playground',
  '/docs/features/prompt-ab',
  '/docs/features/cost-tracking',
  '/docs/features/savings',
  '/docs/features/anomalies',
  '/docs/features/security',
  '/docs/features/alerts',
  '/docs/features/webhooks',
  '/docs/features/datasets',
  '/docs/features/evals',
  '/docs/features/experiments',
  '/docs/features/annotation',
  '/docs/features/saved-filters',
  '/docs/features/export',
  '/docs/features/projects',
  '/docs/features/members-invitations',
  '/docs/features/users',
  '/docs/features/billing',
  '/docs/features/settings',
  '/docs/features/audit-logs',
] as const

const LEGAL_ROUTES = [
  '/privacy',
  '/terms',
  '/dpa',
  '/refund',
  '/subprocessors',
] as const

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date()

  const entries: MetadataRoute.Sitemap = [
    ...MARKETING_ROUTES.map((path) => ({
      url: `${SITE_URL}${path}`,
      lastModified: now,
      changeFrequency: 'weekly' as const,
      priority: path === '' ? 1.0 : 0.8,
    })),
    ...DOCS_ROUTES.map((path) => ({
      url: `${SITE_URL}${path}`,
      lastModified: now,
      changeFrequency: 'weekly' as const,
      priority: path === '/docs' ? 0.9 : 0.6,
    })),
    ...MIGRATION_ROUTES.map((path) => ({
      url: `${SITE_URL}${path}`,
      lastModified: now,
      changeFrequency: 'monthly' as const,
      priority: 0.7,
    })),
    ...LEGAL_ROUTES.map((path) => ({
      url: `${SITE_URL}${path}`,
      lastModified: now,
      changeFrequency: 'yearly' as const,
      priority: 0.3,
    })),
  ]

  return entries
}
