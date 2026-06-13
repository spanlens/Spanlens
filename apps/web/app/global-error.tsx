'use client'

/**
 * Root catch-all for unhandled exceptions that escape app/error.tsx.
 *
 * Next.js calls this when the root layout itself crashes — e.g. a provider
 * throws, a global CSS import fails, or an error escapes the route-level
 * boundary. app/error.tsx runs inside the root layout, so it can't recover
 * from a layout crash; this file owns its own <html>/<body> so React has
 * something to render even when everything above blew up.
 *
 * The styling is intentionally inline + dependency-free. If a CSS or font
 * import is what broke the layout, we still want to render readable text.
 */

import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[global-error]', error)
    // Best-effort sink to our backend so we hear about layout crashes
    // without waiting on a customer report. Fire-and-forget — if the
    // endpoint itself is the thing that crashed, we just swallow.
    try {
      fetch('/api/v1/frontend-errors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        body: JSON.stringify({
          scope: 'global-error',
          message: error.message,
          digest: error.digest,
          stack: error.stack?.slice(0, 4000),
          url: typeof window !== 'undefined' ? window.location.href : null,
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
        }),
      }).catch(() => { /* silent */ })
    } catch { /* silent */ }
  }, [error])

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial',
          background: '#0a0a0a',
          color: '#fafafa',
        }}
      >
        <div style={{ maxWidth: 480, width: '100%' }}>
          <p
            style={{
              fontSize: 72,
              fontWeight: 700,
              color: '#3f3f46',
              margin: '0 0 12px',
              lineHeight: 1,
            }}
          >
            500
          </p>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 8px' }}>
            Spanlens crashed
          </h1>
          <p style={{ color: '#a1a1aa', margin: '0 0 24px', lineHeight: 1.5 }}>
            Something in the app shell threw an exception before the page could
            mount. We have been notified. Try reloading; if it keeps happening
            send us the digest below.
          </p>
          {error.digest && (
            <p
              style={{
                fontFamily: 'ui-monospace, "Cascadia Mono", Menlo, Consolas, monospace',
                fontSize: 12,
                color: '#71717a',
                background: '#18181b',
                border: '1px solid #27272a',
                borderRadius: 6,
                padding: '8px 12px',
                margin: '0 0 24px',
                wordBreak: 'break-all',
              }}
            >
              digest: {error.digest}
            </p>
          )}
          <div style={{ display: 'flex', gap: 12 }}>
            <button
              onClick={reset}
              style={{
                background: '#fafafa',
                color: '#09090b',
                border: 0,
                borderRadius: 6,
                padding: '10px 16px',
                fontSize: 14,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
            <a
              href="/"
              style={{
                background: 'transparent',
                color: '#fafafa',
                border: '1px solid #3f3f46',
                borderRadius: 6,
                padding: '10px 16px',
                fontSize: 14,
                fontWeight: 500,
                cursor: 'pointer',
                textDecoration: 'none',
                display: 'inline-flex',
                alignItems: 'center',
              }}
            >
              Go home
            </a>
          </div>
        </div>
      </body>
    </html>
  )
}
