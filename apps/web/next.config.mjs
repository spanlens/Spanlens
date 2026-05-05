/** @type {import('next').NextConfig} */
const nextConfig = {
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
      config.resolve.alias = {
        ...config.resolve.alias,
        ws: false,
      }
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
