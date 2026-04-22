import type { Context } from 'hono'

/**
 * Edge-runtime-safe fire-and-forget.
 *
 * On Vercel Edge / Cloudflare Workers, a pending promise is dropped the
 * moment the handler returns unless registered with `executionCtx.waitUntil()`.
 *
 * IMPORTANT: Hono's `c.executionCtx` is a getter that THROWS if the underlying
 * runtime doesn't expose one. Merely reading the property can throw. Wrap the
 * whole read attempt in try/catch.
 *
 * On plain Node (dev server / tests) there is no executionCtx, so we fall
 * back to attaching `.catch(console.error)` so the microtask queue drains
 * normally — good enough for dev.
 */
export function fireAndForget(c: Context, promise: Promise<unknown>): void {
  const safePromise = promise.catch((err: unknown) => {
    console.error('[fireAndForget] background task failed:', err)
  })

  try {
    // Access wrapped in try/catch — Hono throws on `.executionCtx` if the
    // runtime doesn't provide one (Vercel Node / local dev).
    const ctx = c.executionCtx as { waitUntil?: (p: Promise<unknown>) => void } | undefined
    if (ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(safePromise)
    }
  } catch {
    // No executionCtx → promise already has .catch, runtime may drain it
    // before exit (Node, Vercel Node functions). On true Edge with no
    // executionCtx we might lose it, but that's a deployment config problem
    // we can't fix from user code.
  }
}
