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
import { Button } from '@/components/ui/button'

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
    <div className="min-h-screen flex flex-col items-center justify-center px-6 bg-bg text-text">
      <div className="max-w-md w-full">
        <p className="text-6xl font-bold text-text-faint mb-3 leading-none">{copy.code}</p>
        <h1 className="text-xl font-bold mb-2">{copy.title}</h1>
        <p className="text-text-muted mb-6 text-sm leading-relaxed">{copy.description}</p>

        {error.digest && (
          <div className="mb-6">
            <button
              type="button"
              onClick={copyDigest}
              className="font-mono text-[11px] text-text-faint hover:text-text-muted transition-colors break-all"
              title="Click to copy"
            >
              digest: {error.digest}
            </button>
          </div>
        )}

        <div className="flex gap-3">
          {copy.primaryAction.href ? (
            <Button asChild>
              <a href={copy.primaryAction.href}>{copy.primaryAction.label}</a>
            </Button>
          ) : (
            <Button onClick={copy.primaryAction.onClick}>{copy.primaryAction.label}</Button>
          )}
          {kind !== 'auth' && copy.primaryAction.href !== '/' && (
            <Button variant="outline" asChild>
              <a href="/">Go home</a>
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
