import { Hono } from 'hono'

/**
 * Frontend error sink.
 *
 * Public endpoint (no auth) — we want to capture errors from logged-out
 * pages too (the login screen, public share viewer, etc). Volume-controlled
 * via per-IP rate limit on the parent /api/v1 group + a tight per-IP cap
 * here, and by accepting only known scope strings so the table doesn't
 * become a spam dumping ground.
 *
 * The body is parsed loosely on purpose — what we get from the
 * `<ErrorBoundary>` and `app/{error,global-error}.tsx` files is whatever
 * the browser can stringify; if a field is missing we still want to log
 * the rest.
 *
 * For now we just log to structured stdout — Vercel surfaces those in the
 * runtime logs and the existing `vercel logs` / log drain pipeline catches
 * them. A dedicated frontend_errors table can be added later if volume
 * justifies, but the schema would have to evolve fast (sourcemaps, release
 * tags, deduplication) so we hold off until the pattern is clear.
 */

const VALID_SCOPES = new Set(['global-error', 'route', 'boundary'])

interface Body {
  scope?: unknown
  kind?: unknown
  label?: unknown
  message?: unknown
  digest?: unknown
  stack?: unknown
  componentStack?: unknown
  url?: unknown
  userAgent?: unknown
}

function pickString(v: unknown, max = 4000): string | null {
  if (typeof v !== 'string') return null
  const trimmed = v.trim()
  if (!trimmed) return null
  return trimmed.slice(0, max)
}

export const frontendErrorsRouter = new Hono()

frontendErrorsRouter.post('/', async (c) => {
  let body: Body
  try {
    body = (await c.req.json()) as Body
  } catch {
    return c.json({ ok: false, error: 'invalid_json' }, 400)
  }

  const scope = typeof body.scope === 'string' && VALID_SCOPES.has(body.scope)
    ? body.scope
    : 'unknown'

  const record = {
    at: new Date().toISOString(),
    scope,
    kind: pickString(body.kind, 32),
    label: pickString(body.label, 80),
    message: pickString(body.message, 500),
    digest: pickString(body.digest, 64),
    stack: pickString(body.stack, 4000),
    componentStack: pickString(body.componentStack, 4000),
    url: pickString(body.url, 500),
    userAgent: pickString(body.userAgent, 500),
    // The remote-address header set by Vercel is best-effort and may
    // legitimately be missing in dev; do not error on absence.
    ip: c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
  }

  // One JSON line per record so log drain consumers can split on \n.
  console.error('[frontend-error]', JSON.stringify(record))

  // Always 204. We never want a sink error to escalate (the client is
  // already in an error state). Anything we surface here just becomes
  // a second error the user has to deal with.
  return c.body(null, 204)
})
