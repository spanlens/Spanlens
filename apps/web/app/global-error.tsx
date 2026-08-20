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
 *
 * That constraint also means globals.css never loads here, so the design
 * tokens do not exist and neither does the ThemeProvider that sets `.dark`.
 * GLOBAL_ERROR_CSS below therefore re-declares the handful of token values
 * this page needs and switches them on `prefers-color-scheme`, which is the
 * only theme signal still available. Keep the values in sync with the
 * `:root` / `.dark` blocks in app/globals.css.
 */

import * as Sentry from '@sentry/nextjs'
import { useEffect } from 'react'

const GLOBAL_ERROR_CSS = `
:root {
  --ge-bg: #ffffff;
  --ge-elev: #ffffff;
  --ge-sunk: #f3f3f6;
  --ge-border: #e2e2e8;
  --ge-text: #101114;
  --ge-faint: #6b7078;
  --ge-bad: #b32c0a;
  --ge-accent: #d0350f;
  --ge-accent-fg: #ffffff;
  --ge-shadow: 0 1px 2px rgba(16,17,20,.04), 0 8px 24px -12px rgba(16,17,20,.1);
}
@media (prefers-color-scheme: dark) {
  :root {
    --ge-bg: #0c0d10;
    --ge-elev: #141619;
    --ge-sunk: #1b1e23;
    --ge-border: #272a30;
    --ge-text: #f2f3f5;
    --ge-faint: #9aa1aa;
    --ge-bad: #ff8a63;
    --ge-accent: #ff5a2b;
    --ge-accent-fg: #0c0d10;
    --ge-shadow: 0 1px 2px rgba(0,0,0,.5), 0 8px 24px -12px rgba(0,0,0,.6);
  }
}
.ge-body {
  margin: 0;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 64px 24px;
  background: var(--ge-bg);
  color: var(--ge-text);
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
}
.ge-card {
  width: 100%;
  max-width: 560px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 52px 40px 30px;
  text-align: center;
  background: var(--ge-elev);
  border: 1px solid var(--ge-border);
  border-radius: 16px;
  box-shadow: var(--ge-shadow);
}
.ge-code {
  margin: 0;
  font-size: 46px;
  font-weight: 800;
  line-height: 1;
  letter-spacing: -0.03em;
  color: var(--ge-bad);
}
.ge-title {
  margin: 0;
  font-size: 16px;
  font-weight: 800;
  line-height: 1.5;
  letter-spacing: -0.015em;
}
.ge-body-copy {
  margin: 0;
  max-width: 380px;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--ge-faint);
}
.ge-digest {
  margin: 0;
  max-width: 100%;
  word-break: break-all;
  font-family: ui-monospace, "Cascadia Mono", Menlo, Consolas, monospace;
  font-size: 11px;
  line-height: 1.5;
  color: var(--ge-faint);
  background: var(--ge-sunk);
  border-radius: 8px;
  padding: 7px 12px;
}
.ge-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin-top: 4px; }
.ge-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 39px;
  padding: 0 18px;
  border-radius: 999px;
  border: 1px solid transparent;
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  text-decoration: none;
}
.ge-btn-primary { background: var(--ge-accent); color: var(--ge-accent-fg); }
.ge-btn-secondary { background: var(--ge-elev); color: var(--ge-text); border-color: var(--ge-border); }
`

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[global-error]', error)
    // Sentry does NOT capture root-layout crashes on its own — App Router
    // routes them here instead of through the SDK's error hooks, so without
    // this call a layout crash is invisible in Sentry even though the SDK is
    // initialised (instrumentation-client.ts). Wrapped in its own try/catch:
    // this file is the last line of defence and must never throw.
    try {
      Sentry.captureException(error)
    } catch { /* silent */ }
    // Best-effort sink to our backend so we hear about layout crashes
    // without waiting on a customer report. Kept alongside Sentry rather than
    // replaced by it: this one survives an ad blocker eating the Sentry
    // request. Fire-and-forget — if the endpoint itself is the thing that
    // crashed, we just swallow.
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
      <head>
        <style dangerouslySetInnerHTML={{ __html: GLOBAL_ERROR_CSS }} />
      </head>
      <body className="ge-body">
        <div className="ge-card">
          <p className="ge-code">500</p>
          <h1 className="ge-title">Something broke on our side</h1>
          <p className="ge-body-copy">
            Your requests keep being logged through the proxy. Only this page failed to render, and we have
            been notified.
          </p>
          {error.digest && <p className="ge-digest">digest {error.digest}</p>}
          <div className="ge-actions">
            <button type="button" onClick={reset} className="ge-btn ge-btn-primary">
              Try again
            </button>
            <a href="/" className="ge-btn ge-btn-secondary">
              Go home
            </a>
          </div>
        </div>
      </body>
    </html>
  )
}
