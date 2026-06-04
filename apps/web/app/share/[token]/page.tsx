import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { ShareView } from './share-view'

interface SharePayload {
  scope: 'trace' | 'request'
  indexable: boolean
  createdAt: string
  expiresAt: string | null
  viewCount: number
  payload: unknown
}

// SSR fetch: the share viewer renders read-only data, so we render the entire
// page on the server. No client-side query / no auth. Falls back to notFound()
// on any non-2xx so 404 / 410 / 500 all funnel through Next.js's not-found
// boundary (consistent UX, no leaked status code).
async function fetchShare(token: string): Promise<SharePayload | null> {
  const apiUrl =
    process.env.API_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    'http://localhost:3001'

  try {
    const res = await fetch(`${apiUrl}/share/${encodeURIComponent(token)}`, {
      // No caching: each viewer should hit the server (it bumps view_count).
      cache: 'no-store',
    })
    if (!res.ok) return null
    const body = (await res.json()) as { success?: boolean; data?: SharePayload }
    if (!body.success || !body.data) return null
    return body.data
  } catch {
    return null
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>
}): Promise<Metadata> {
  const { token } = await params
  const share = await fetchShare(token)
  const robots = share?.indexable
    ? { index: true, follow: true }
    : { index: false, follow: false }
  const scope = share?.scope === 'request' ? 'Request' : 'Trace'
  return {
    title: share ? `Shared ${scope} · Spanlens` : 'Share · Spanlens',
    description: 'A shared LLM trace observed by Spanlens.',
    robots,
  }
}

export default async function ShareTokenPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params

  // Validate the token format superficially before hitting the API — keeps
  // garbage URLs from incrementing rate-limit buckets.
  if (!token || token.length < 8 || token.length > 128) notFound()

  // headers() is referenced so this page is treated as fully dynamic and the
  // server-side fetch runs per request (no static caching of share contents).
  await headers()

  const share = await fetchShare(token)
  if (!share) notFound()

  return <ShareView share={share} />
}
