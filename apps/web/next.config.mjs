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
}

export default nextConfig
