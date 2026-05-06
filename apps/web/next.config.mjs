import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/** @type {import('next').NextConfig} */
const nextConfig = {
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

export default nextConfig
