import path from 'node:path'
import { fileURLToPath } from 'node:url'
import bundleAnalyzer from '@next/bundle-analyzer'
import { withSentryConfig } from '@sentry/nextjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Run `pnpm --filter web analyze` to emit a treemap report at .next/analyze/
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

  // @supabase/realtime-js@2.104.0 depends on 'ws' which references __dirname
  // at module initialisation time. __dirname is undefined in Next.js Edge
  // Runtime (middleware), causing MIDDLEWARE_INVOCATION_FAILED on every request.
  //
  // Fix: for Edge builds, alias 'ws' → false (empty module) so the bundler
  // drops it; Edge Runtime provides WebSocket natively as a global.
  // DefinePlugin provides __dirname / __filename as a safety net for any
  // remaining stray reference.
  webpack(config, { nextRuntime, webpack: webpackInstance }) {
    if (nextRuntime === 'edge') {
      // @supabase/realtime-js@2.104.0 depends on the 'ws' package which
      // references __dirname at module init → ReferenceError in Edge Runtime.
      // Middleware never uses Realtime subscriptions, so we redirect the
      // whole package to a local no-op stub. Aliasing to `false` (empty
      // object) is wrong here because @supabase/supabase-js calls
      // `new RealtimeClient()` unconditionally → "is not a constructor".
      config.resolve.alias = {
        ...config.resolve.alias,
        '@supabase/realtime-js': path.resolve(__dirname, 'lib/realtime-stub.js'),
        ws: false,
      }
      // Belt-and-suspenders: replace any residual __dirname / __filename
      // identifier that slips through (e.g. from inlined polyfills).
      config.plugins.push(
        new webpackInstance.DefinePlugin({
          __dirname: JSON.stringify('/'),
          __filename: JSON.stringify(''),
        }),
      )
    }
    return config
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
