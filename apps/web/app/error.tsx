'use client'

/**
 * Route-level error boundary. Catches anything that escapes a page or
 * client component within a (dashboard) route. Differentiates between
 * five common error shapes so the user gets actionable text + a useful
 * primary action, instead of one generic "Something went wrong".
 *
 * Hierarchy:
 *   - global-error.tsx — owns its own <html>, only runs when the layout
 *                        itself crashed (e.g. provider exploded).
 *   - error.tsx        — runs inside the layout. This is the common path.
 *   - <ErrorBoundary>  — per-panel client-side, for risky widgets.
 */

import { useEffect } from 'react'
import { stateActionPrimary, stateActionSecondary, stateCard } from '@/components/ui/empty-state'

type ErrorKind = 'auth' | 'not-found' | 'network' | 'permission' | 'other'

interface ErrorCopy {
  code: string
  title: string
  description: string
  primaryAction: { label: string; href?: string; onClick?: () => void }
}

function classify(error: Error & { digest?: string }): ErrorKind {
  const msg = (error.message || '').toLowerCase()
  // Next.js's notFound() throws an error whose digest starts with "NEXT_NOT_FOUND".
  // App-thrown 4xx fetches usually surface as "401", "404", "fetch failed", etc.
  if (error.digest?.startsWith('NEXT_NOT_FOUND')) return 'not-found'
  if (msg.includes('401') || msg.includes('unauthor') || msg.includes('session expired')) return 'auth'
  if (msg.includes('403') || msg.includes('forbidden') || msg.includes('permission')) return 'permission'
  if (msg.includes('404') || msg.includes('not found')) return 'not-found'
  if (msg.includes('fetch failed') || msg.includes('network') || msg.includes('failed to fetch')) return 'network'
  return 'other'
}

function getCopy(kind: ErrorKind, reset: () => void): ErrorCopy {
  switch (kind) {
    case 'auth':
      return {
        code: '401',
        title: 'Your session expired',
        description: 'Sign in again to continue. Your in-flight work was not saved.',
        primaryAction: { label: 'Sign in', href: '/login' },
      }
    case 'permission':
      return {
        code: '403',
        title: "You don't have access to this resource",
        description: 'Ask a workspace admin to grant access, or switch to a workspace where you are a member.',
        primaryAction: { label: 'Go to dashboard', href: '/dashboard' },
      }
    case 'not-found':
      return {
        code: '404',
        title: "We couldn't find that page",
        description: 'The resource may have been deleted, or the URL is wrong.',
        primaryAction: { label: 'Go to dashboard', href: '/dashboard' },
      }
    case 'network':
      return {
        code: 'net',
        title: 'Connection issue',
        description: 'We could not reach the Spanlens server. Check your network and retry.',
        primaryAction: { label: 'Retry', onClick: reset },
      }
    default:
      return {
        code: '500',
        title: 'Something went wrong',
        description: 'An unexpected error occurred. Try again, or send us the digest below if it keeps happening.',
        primaryAction: { label: 'Try again', onClick: reset },
      }
  }
}

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const kind = classify(error)
  const copy = getCopy(kind, reset)

  useEffect(() => {
    console.error(`[route-error:${kind}]`, error)
    try {
      fetch('/api/v1/frontend-errors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        body: JSON.stringify({
          scope: 'route',
          kind,
          message: error.message,
          digest: error.digest,
          stack: error.stack?.slice(0, 4000),
          url: typeof window !== 'undefined' ? window.location.href : null,
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
        }),
      }).catch(() => { /* silent */ })
    } catch { /* silent */ }
  }, [error, kind])

  async function copyDigest(): Promise<void> {
    if (!error.digest) return
    try { await navigator.clipboard?.writeText(error.digest) } catch { /* silent */ }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-6 py-16">
      <div className={`w-full max-w-[560px] ${stateCard}`}>
        <div className="flex flex-col items-center gap-3 px-10 pb-[30px] pt-[52px] text-center">
          {/* The code carries the failure colour so the card reads as an error
              before any of the copy is parsed. 404 is a routing miss, not a
              fault, so it stays in ink. */}
          <p
            className={`font-display track-h2 text-[46px] leading-none ${
              kind === 'not-found' ? 'text-text' : 'text-bad'
            }`}
          >
            {copy.code}
          </p>
          <h1 className="font-display track-quote text-[16px] leading-[1.5] text-text">{copy.title}</h1>
          <p className="max-w-[380px] text-[12.5px] leading-[1.6] text-text-faint">{copy.description}</p>

          {error.digest && (
            <button
              type="button"
              onClick={copyDigest}
              title="Click to copy"
              className="max-w-full break-all rounded-sm bg-bg-sunk px-3 py-[7px] font-mono text-[11px] leading-[1.5] text-text-faint transition-colors hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg-elev"
            >
              digest {error.digest}
            </button>
          )}

          <div className="mt-1 flex flex-wrap justify-center gap-2">
            {copy.primaryAction.href ? (
              <a href={copy.primaryAction.href} className={stateActionPrimary}>
                {copy.primaryAction.label}
              </a>
            ) : (
              <button type="button" onClick={copy.primaryAction.onClick} className={stateActionPrimary}>
                {copy.primaryAction.label}
              </button>
            )}
            {kind !== 'auth' && copy.primaryAction.href !== '/' && (
              <a href="/" className={stateActionSecondary}>
                Go home
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
