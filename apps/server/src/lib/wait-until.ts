import type { Context } from 'hono'
import { waitUntil as vercelWaitUntil } from '@vercel/functions'

/**
 * Edge/Serverless-safe fire-and-forget.
 *
 * Vercel Edge drops pending promises the moment the handler returns. The
 * authoritative fix is `@vercel/functions`' `waitUntil`, which Vercel keeps
 * alive across both Edge and Node serverless runtimes.
 *
 * Fallback order:
 *   1. `@vercel/functions` waitUntil (Vercel prod + preview)
 *   2. Hono's `c.executionCtx.waitUntil` (Cloudflare Workers)
 *   3. Bare `.catch()` (Node dev / tests — runtime usually drains before exit)
 */
export function fireAndForget(c: Context, promise: Promise<unknown>): void {
  const safePromise = promise.catch((err: unknown) => {
    console.error('[fireAndForget] background task failed:', err)
  })

  // 1. Try Vercel's waitUntil — handles both Edge and Node serverless
  try {
    vercelWaitUntil(safePromise)
    return
  } catch {
    /* fall through */
  }

  // 2. Try Hono's executionCtx (Cloudflare Workers etc.)
  try {
    const ctx = c.executionCtx as { waitUntil?: (p: Promise<unknown>) => void } | undefined
    if (ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(safePromise)
      return
    }
  } catch {
    /* fall through */
  }

  // 3. Node dev: safePromise has .catch, runtime drains it
}
