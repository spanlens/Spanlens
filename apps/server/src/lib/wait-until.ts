import type { Context } from 'hono'

/**
 * Edge-runtime-safe fire-and-forget.
 *
 * On Vercel Edge / Cloudflare Workers, a pending promise is dropped the
 * moment the handler returns — even with `.catch()` attached. The runtime
 * only keeps it alive if you register it with `executionCtx.waitUntil()`.
 *
 * On plain Node (dev server / tests) there is no executionCtx, so we fall
 * back to attaching `.catch(console.error)` so the microtask queue drains
 * before process exit.
 */
export function fireAndForget(c: Context, promise: Promise<unknown>): void {
  const safePromise = promise.catch((err: unknown) => {
    console.error('[fireAndForget] background task failed:', err)
  })

  const ctx = (c as { executionCtx?: { waitUntil?: (p: Promise<unknown>) => void } }).executionCtx
  if (ctx?.waitUntil) {
    try {
      ctx.waitUntil(safePromise)
      return
    } catch {
      /* fall through to no-op — promise already has catch handler */
    }
  }
  // Node dev: promise already has .catch, nothing more to do
}
