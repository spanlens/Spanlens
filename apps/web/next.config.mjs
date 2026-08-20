import bundleAnalyzer from '@next/bundle-analyzer'
import { withSentryConfig } from '@sentry/nextjs'

// NOTE: `pnpm --filter web analyze` is currently a no-op. @next/bundle-analyzer
// early-returns with a warning whenever `process.env.TURBOPACK` is set, and
// Next 16 sets it to 'auto' because our build script is a bare `next build`
// with no bundler flag. It emits no treemap at .next/analyze/. Kept wired up so
// the option is one flag away: run `next build --webpack` (or Next's
// `experimental-analyze`) when a treemap is actually needed. Chunk composition
// can also be inspected directly from .next/static/chunks + the per-route
// build-manifest.json / react-loadable-manifest.json files, which is how the
// recharts duplication was measured.
const withBundleAnalyzer = bundleAnalyzer({ enabled: process.env.ANALYZE === 'true' })

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable standalone output for Docker self-hosted deployments.
  // Produces apps/web/.next/standalone — a self-contained Node server with
  // only the traced runtime dependencies bundled in (no full node_modules copy).
  output: 'standalone',
  experimental: {
    // Tree-shake barrel-export packages so only used symbols land in the bundle.
    // Cuts recharts, lucide-react, and Radix from the initial JS chunk.
    optimizePackageImports: [
      'lucide-react',
      'recharts',
      '@radix-ui/react-dialog',
      '@radix-ui/react-dropdown-menu',
      '@radix-ui/react-select',
      '@radix-ui/react-tabs',
      '@radix-ui/react-tooltip',
      '@radix-ui/react-toast',
      'cmdk',
    ],
  },
  // Proxy /api/* → spanlens-server via Next.js rewrites so all fetches from
  // the browser stay same-origin. Eliminates the CORS preflight (OPTIONS)
  // that the old cross-origin setup required on every fetch — ~50–150ms
  // savings per query on browsers over cold TCP.
  //
  // Read at build time (not `NEXT_PUBLIC_`) so the server URL never ships
  // in the client bundle.
  async redirects() {
    return [
      { source: '/recommendations', destination: '/savings', permanent: true },
      // /doc → /docs (mistyped singular; common typo, surfaced as a 404 in analytics)
      { source: '/doc', destination: '/docs', permanent: true },
      { source: '/doc/:path*', destination: '/docs/:path*', permanent: true },
    ]
  },
  // Security response headers (ScreamingFrog 2026-06-11 audit: all four were
  // missing site-wide). CSP is intentionally limited to frame-ancestors —
  // a full script-src policy would need to allowlist Paddle's checkout
  // overlay, Vercel Analytics, Sentry, and Next.js inline bootstrap scripts,
  // and a miss there silently breaks checkout. frame-ancestors alone blocks
  // clickjacking (the actual attack the header exists for) with zero
  // breakage risk. X-Frame-Options is the legacy equivalent for older
  // browsers.
  async headers() {
    // Machine-readable files consumed by crawlers and LLM agents. Their
    // contents only change on deploy, but all six shipped with
    // `Cache-Control: public, max-age=0, must-revalidate`, so the Vercel edge
    // revalidated against the origin on every single hit — no CDN caching at
    // all. `s-maxage=3600` lets the edge serve them for an hour and
    // `stale-while-revalidate=86400` keeps crawlers served from cache while a
    // stale copy refreshes in the background, so an origin blip never turns
    // into a failed crawl. `max-age=0` is kept deliberately: browsers still
    // revalidate, because a robots.txt pinned in a user's disk cache is never
    // acceptable. A new deployment purges the edge cache, so an hour of
    // s-maxage never delays a content change going live.
    const MACHINE_READABLE_CACHE_CONTROL =
      'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400'

    // First four are real files in public/; last two are Next metadata routes
    // (app/robots.ts, app/sitemap.ts) prerendered to static build output.
    //
    // Why these are set here rather than on the routes themselves: `export
    // const revalidate` does NOT influence the response header for metadata
    // routes. Next's metadata-route loader hardcodes
    // `Cache-Control: public, max-age=0, must-revalidate` into the generated
    // handler (next/dist/build/webpack/loaders/next-metadata-route-loader.js,
    // CACHE_HEADERS.REVALIDATE), and next/dist/build/templates/app-route.js
    // only applies the revalidate-derived `s-maxage` when the response carries
    // no Cache-Control of its own. Confirmed in this repo's build output:
    // .next/server/app/robots.txt.meta pins that exact value.
    const MACHINE_READABLE_PATHS = [
      '/llms.txt',
      '/llms-full.txt',
      '/AGENTS.md',
      '/pricing.md',
      '/robots.txt',
      '/sitemap.xml',
    ]

    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
        ],
      },
      ...MACHINE_READABLE_PATHS.map((source) => ({
        source,
        headers: [{ key: 'Cache-Control', value: MACHINE_READABLE_CACHE_CONTROL }],
      })),
    ]
  },
  async rewrites() {
    const apiUrl =
      process.env.API_URL ??
      process.env.NEXT_PUBLIC_API_URL ??
      'http://localhost:3001'
    return [
      {
        source: '/api/:path*',
        destination: `${apiUrl}/api/:path*`,
      },
      // PLG Loop ① — the share page (web) calls the server's public viewer at
      // /share/:token via an XHR. Same-origin rewrite keeps it simple; the
      // server route is rate-limited per-IP so direct access is also safe.
      // We expose the API path under /api/share-view/* to avoid colliding
      // with the Next.js page route at /share/[token].
      {
        source: '/api/share-view/:token',
        destination: `${apiUrl}/share/:token`,
      },
      // PLG Loop ③ — README badge SVG. Lives under the marketing domain
      // (spanlens.io/badge/<org>.svg) so URLs pasted into READMEs hit the
      // canonical site, not the server's bare host. Static SVG → CDN caches.
      {
        source: '/badge/:path*',
        destination: `${apiUrl}/badge/:path*`,
      },
    ]
  },
}

const sentryConfig = {
  // Only upload source maps in CI/production to avoid slowing local builds
  silent: true,
  // Suppress the Sentry CLI output in CI
  hideSourceMaps: true,
  // Disable Sentry when DSN is not set (local dev without secrets)
  disableLogger: true,
  // Tunnel Sentry requests through Next.js to avoid ad-blocker interference
  tunnelRoute: '/monitoring',
}

export default withSentryConfig(withBundleAnalyzer(nextConfig), sentryConfig)
