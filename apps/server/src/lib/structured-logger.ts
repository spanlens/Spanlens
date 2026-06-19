/**
 * Structured logger for server-side error/warn paths.
 *
 * Why this exists: the codebase has 151 `console.error(...)` call sites
 * across 45 files (audit 2026-06-12). Each one writes a free-form string,
 * so Sentry sees "Failed to fetch org" with no orgId, requestId, or
 * cron_job_name attached — and the operator has to grep server logs to
 * figure out which tenant is affected. Worse, a few sites (notably
 * lib/logger.ts:306) interpolate raw request bodies, which can leak PII
 * into the search-indexed Sentry breadcrumbs.
 *
 * This module is the single replacement target:
 *   - `logError(code, context, err?)` — structured emission with required
 *     code + bag-of-context + optional Error. Auto-applies `maskApiKeys`
 *     to every string value in the context before serialization.
 *   - `logWarn(code, context, err?)` — same shape for non-error severity.
 *
 * Output format is one line per call, prefixed with the level + code so
 * `grep -E "ERROR\\[CH_INSERT_FAILED\\]" server.log` works. JSON-encoded
 * payload follows for parsability. Sentry's `captureException` is *not*
 * called here — that's the responsibility of the global onError handler
 * in app.ts so we don't double-capture.
 *
 * Migration policy: new code MUST use logError/logWarn. Old console.error
 * sites are migrated opportunistically — the ESLint rule in CI flags new
 * ones but doesn't rewrite existing ones (would balloon this PR).
 */

import { maskApiKeys } from './pii-mask.js'

/** Stable error codes — extend the union as call sites are migrated. */
export type LogCode =
  // logger.ts hot path
  | 'CH_INSERT_FAILED'
  | 'FALLBACK_INSERT_FAILED'
  // webhook delivery
  | 'WEBHOOK_DISPATCH_FAILED'
  | 'WEBHOOK_FETCH_FAILED'
  // proxy upstream
  | 'UPSTREAM_FETCH_FAILED'
  // rate limiting backend (Redis/Upstash) unavailable — fail-open is in effect
  | 'RATE_LIMIT_BACKEND_DOWN'
  // per-minute proxy ceiling exceeded — pass-through anti-runaway signal (not a block)
  | 'PROXY_RATE_LIMIT_OVERAGE'
  // Paddle billing
  | 'PADDLE_WEBHOOK_FAILED'
  | 'PADDLE_API_FAILED'
  // cron jobs (job_name on context distinguishes)
  | 'CRON_JOB_FAILED'
  | 'CRON_PARTIAL_FAILURE'
  // catch-all for sites that haven't been categorized yet
  | 'UNCATEGORIZED'

/**
 * Free-form context bag. Required fields (`orgId`, `requestId` etc.) are
 * documented per-code in the call sites, not enforced here — making them
 * mandatory would block the gradual migration. Strings are PII-masked
 * before output; numbers/booleans/nulls are emitted as-is.
 */
export interface LogContext {
  /** Org affected by the error, when known. */
  orgId?: string | null
  /** Vercel/Hono request id from middleware/requestId.ts. */
  requestId?: string | null
  /** For cron paths — the job name from vercel.json. */
  jobName?: string | null
  /** Provider tag for proxy paths (openai/anthropic/gemini/azure). */
  provider?: string | null
  /** Webhook id when emitting a delivery failure. */
  webhookId?: string | null
  /** Anything else the call site wants to record. */
  [key: string]: unknown
}

function maskValue(v: unknown): unknown {
  if (typeof v === 'string') return maskApiKeys(v)
  if (Array.isArray(v)) return v.map(maskValue)
  if (v && typeof v === 'object' && !(v instanceof Error)) {
    const out: Record<string, unknown> = {}
    for (const [k, vv] of Object.entries(v)) out[k] = maskValue(vv)
    return out
  }
  return v
}

function serializeError(err: unknown): { message: string; name?: string; stack?: string } {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: maskApiKeys(err.message),
      // Stack is not masked — it can contain hand-typed API keys in test
      // fixtures, but the cost of mangling stacks is bigger than the
      // benefit. Sentry already redacts known secret patterns.
      ...(err.stack ? { stack: err.stack } : {}),
    }
  }
  return { message: maskApiKeys(typeof err === 'string' ? err : JSON.stringify(err)) }
}

function emit(level: 'ERROR' | 'WARN', code: LogCode, context: LogContext, err?: unknown): void {
  const payload: Record<string, unknown> = {
    level,
    code,
    ts: new Date().toISOString(),
    ...(maskValue(context) as Record<string, unknown>),
  }
  if (err !== undefined) {
    payload['err'] = serializeError(err)
  }
  // Single line, prefixed for grep-ability.
  const line = `${level}[${code}] ${JSON.stringify(payload)}`
  // The no-console rule is not active in this codebase (the lint config
  // permits console.error/warn — only console.log is discouraged), so the
  // earlier `// eslint-disable-next-line no-console` lines were no-ops
  // and warned as unused directives.
  if (level === 'ERROR') {
    console.error(line)
  } else {
    console.warn(line)
  }
}

export function logError(code: LogCode, context: LogContext, err?: unknown): void {
  emit('ERROR', code, context, err)
}

export function logWarn(code: LogCode, context: LogContext, err?: unknown): void {
  emit('WARN', code, context, err)
}
