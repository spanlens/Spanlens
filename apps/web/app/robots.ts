import type { MetadataRoute } from 'next'

const SITE_URL = 'https://www.spanlens.io'

/**
 * Paths no crawler may fetch, regardless of which user-agent group it matches.
 *
 * Per the robots.txt spec a crawler obeys ONLY the single most-specific
 * user-agent group that matches it — groups do NOT inherit from `*`. So this
 * list has to be repeated into every named group below, not just the wildcard
 * one. Before this was extracted into a shared constant, each AI-bot group was
 * `{ userAgent: 'GPTBot', allow: '/' }` with no disallow, which meant GPTBot /
 * ClaudeBot / PerplexityBot / CCBot and friends were explicitly permitted to
 * crawl /api/, /dashboard, /admin and — worst of all — /share/<token>, the
 * token-based viewer that is deliberately closed to Googlebot.
 */
const DISALLOWED_PATHS = [
  '/api/',
  // No trailing slash on these two. `Disallow: /onboarding/` only matches paths
  // that START WITH `/onboarding/`, so the route that actually exists —
  // `/onboarding`, a top-level page.tsx listed in middleware's PROTECTED_PATHS —
  // stayed crawlable and kept sending crawlers into its 307 to /login. Same
  // shape for `/invite` (public accept page, always reached with a `?token=`).
  // The slashless prefix covers both the bare path and anything beneath it.
  '/onboarding',
  '/login',
  '/signup',
  '/verify-email',
  '/forgot-password',
  '/reset-password',
  '/invite',
  '/auth/',
  // PLG Loop ① — share pages default to noindex via per-page Metadata.
  // Disallowed here as defence in depth; opt-in indexable shares rely
  // on the per-page robots meta and direct manual links still work.
  '/share/',
  // Auth-gated dashboard routes live at the top level (route group
  // `(dashboard)` doesn't add a URL segment), so each one needs its
  // own disallow — crawlers were following these into 307 login
  // redirects (ScreamingFrog 2026-06-11 audit: 19 internal 3xx).
  // Keep in sync with apps/web/app/(dashboard)/* and middleware.ts's
  // PROTECTED_PATHS.
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
]

/**
 * AI / LLM crawlers we deliberately welcome onto public content.
 *
 * Each gets its own group carrying an explicit `allow: '/'` — that is the
 * opt-in signal (several of these bots treat the absence of a named group as
 * a reason to back off, and Google-Extended / Applebot-Extended are pure
 * opt-out switches). The private paths above still apply to every one of them.
 */
const AI_CRAWLER_USER_AGENTS = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'Google-Extended',
  'PerplexityBot',
  'Perplexity-User',
  'ClaudeBot',
  'Claude-Web',
  'anthropic-ai',
  'CCBot',
  'cohere-ai',
  'Applebot-Extended',
  'Bytespider',
  'meta-externalagent',
]

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      // Fresh array per group so no consumer can mutate the shared constant.
      { userAgent: '*', allow: '/', disallow: [...DISALLOWED_PATHS] },
      ...AI_CRAWLER_USER_AGENTS.map((userAgent) => ({
        userAgent,
        allow: '/',
        disallow: [...DISALLOWED_PATHS],
      })),
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  }
}
