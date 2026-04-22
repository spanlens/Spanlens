import { app } from '../src/app.js'

/**
 * Node.js serverless runtime (not Edge).
 *
 * Rationale — Vercel Edge has a hard 25-30s per-request timeout. Real customer
 * LLM calls (long chat transcripts + generous max_tokens) can exceed that,
 * causing 504 FUNCTION_INVOCATION_TIMEOUT on the proxy. Node functions allow
 * up to 60s on Hobby and 300s on Pro.
 *
 * Hono's `app.fetch` is a standard Web Request → Response handler, so it works
 * on Node runtime unchanged — the only tradeoff is a slightly slower cold start
 * vs. Edge. `@vercel/functions` `waitUntil` (our background logging drain)
 * works on both runtimes.
 */
export const maxDuration = 60

export default app.fetch
