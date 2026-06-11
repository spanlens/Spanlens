import type { MetadataRoute } from 'next'

const SITE_URL = 'https://www.spanlens.io'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          '/onboarding/',
          '/login',
          '/signup',
          '/verify-email',
          '/forgot-password',
          '/reset-password',
          '/invite/',
          '/auth/',
          // PLG Loop ① — share pages default to noindex via per-page Metadata.
          // Disallowed here as defence in depth; opt-in indexable shares rely
          // on the per-page robots meta and direct manual links still work.
          '/share/',
          // Auth-gated dashboard routes live at the top level (route group
          // `(dashboard)` doesn't add a URL segment), so each one needs its
          // own disallow — crawlers were following these into 307 login
          // redirects (ScreamingFrog 2026-06-11 audit: 19 internal 3xx).
          '/admin',
          '/alerts',
          '/annotation',
          '/anomalies',
          '/billing',
          '/dashboard',
          '/datasets',
          '/evals',
          '/experiments',
          '/projects',
          '/prompts',
          '/requests',
          '/savings',
          '/security',
          '/sessions',
          '/settings',
          '/shares',
          '/traces',
          '/users',
        ],
      },
      { userAgent: 'GPTBot', allow: '/' },
      { userAgent: 'OAI-SearchBot', allow: '/' },
      { userAgent: 'ChatGPT-User', allow: '/' },
      { userAgent: 'Google-Extended', allow: '/' },
      { userAgent: 'PerplexityBot', allow: '/' },
      { userAgent: 'Perplexity-User', allow: '/' },
      { userAgent: 'ClaudeBot', allow: '/' },
      { userAgent: 'Claude-Web', allow: '/' },
      { userAgent: 'anthropic-ai', allow: '/' },
      { userAgent: 'CCBot', allow: '/' },
      { userAgent: 'cohere-ai', allow: '/' },
      { userAgent: 'Applebot-Extended', allow: '/' },
      { userAgent: 'Bytespider', allow: '/' },
      { userAgent: 'meta-externalagent', allow: '/' },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  }
}
