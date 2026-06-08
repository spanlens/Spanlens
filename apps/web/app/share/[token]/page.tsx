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
  hidePoweredBy?: boolean
  payload: unknown
}

/**
 * Canonical site URL — used for the share permalink + OG image base.
 * WEB_URL is the same env var the server-side notification code uses
 * (see CLAUDE.md "도메인 & CORS 정책"). NEXT_PUBLIC_WEB_URL is the
 * fallback for branch deploys where only the public version is set.
 */
function siteUrl(): string {
  return (
    process.env.WEB_URL ??
    process.env.NEXT_PUBLIC_WEB_URL ??
    'https://www.spanlens.io'
  )
}

/**
 * Pull a human-readable preview snippet from the share payload so the
 * OG `description` actually represents the content. The share API
 * already returns redacted payloads when the share is non-indexable,
 * so this snippet is safe to publish (PII-scrubbed at the source).
 *
 * Cap at 140 chars so the result fits Twitter card constraints and
 * social previews don't truncate mid-sentence.
 */
function previewDescription(share: SharePayload): string {
  const fallback = 'A shared LLM trace observed by Spanlens.'
  const payload = share.payload
  if (!payload || typeof payload !== 'object') return fallback

  if (share.scope === 'trace') {
    const t = payload as { name?: string | null; status?: string | null }
    if (t.name) return `${t.name}${t.status ? ` (${t.status})` : ''}`.slice(0, 140)
  }
  if (share.scope === 'request') {
    const r = payload as { provider?: string; model?: string; status_code?: number }
    if (r.provider && r.model) {
      return `${r.provider} · ${r.model}${r.status_code ? ` · ${r.status_code}` : ''}`.slice(
        0,
        140,
      )
    }
  }
  return fallback
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
  const title = share ? `Shared ${scope} · Spanlens` : 'Share · Spanlens'
  const description = share ? previewDescription(share) : 'A shared LLM trace observed by Spanlens.'
  const url = `${siteUrl()}/share/${encodeURIComponent(token)}`

  // R-26 Sprint 5: emit OG + Twitter card metadata so the share link
  // produces a useful preview when posted to Slack, X, LinkedIn, etc.
  // We intentionally do NOT set `openGraph.images` yet — there is no
  // canonical share preview asset in /public, and pointing at a path
  // that 404s makes Slack/X show a broken-image card (worse than no
  // image, which falls back to the site favicon). Sprint 6 owns either
  // a static `/og-share.png` upload or a dynamic `/api/og-image` route
  // that renders a per-trace summary card via vercel/og. The current
  // metadata still drives a clean text card with title + description.
  return {
    title,
    description,
    robots,
    alternates: {
      canonical: url,
    },
    openGraph: {
      title,
      description,
      url,
      siteName: 'Spanlens',
      type: 'article',
    },
    twitter: {
      card: 'summary',
      title,
      description,
    },
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

  // Build the permalink server-side so the CopyPermalink button doesn't
  // touch `window.location` at first render — share-view.tsx is a Client
  // Component but the very first hydration pass runs both SSR and CSR,
  // and `window` is undefined in SSR. Passing the URL down explicitly
  // keeps the two passes identical (no React hydration mismatch).
  const permalink = `${siteUrl()}/share/${encodeURIComponent(token)}`

  return <ShareView share={{ ...share, permalink }} />
}
