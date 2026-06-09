/**
 * Hono RPC client for apps/server, bound to the live AppType.
 *
 * This file IS the only place in apps/web that is allowed to import from
 * `apps/server` (type-only). The dependency direction
 * `packages/* → apps/*` is forbidden by CLAUDE.md, but `apps/web → apps/server`
 * is allowed as long as the import is type-only so no server runtime code
 * leaks into the Next bundle. `import type` plus `verbatimModuleSyntax` in
 * tsconfig.base.json guarantees that.
 *
 * Why bind here instead of inside `@spanlens/api-types`: the AppType is
 * generated from the running router tree in `apps/server/src/app.ts`. A
 * package that re-exported AppType would have to depend on `server`,
 * which violates the packages-to-apps direction. Putting the binding in
 * `apps/web` keeps the dependency arrow pointing the right way and still
 * gives every fetch end-to-end type safety.
 *
 * Usage:
 *
 *   import { apiClient, throwIfApiError } from '@/lib/api-client'
 *
 *   const res = await apiClient.api.v1.shares.$get({ query: { scope: 'org' } })
 *   await throwIfApiError(res)
 *   const body = await res.json()
 *   // body is { success: true, data: ShareRow[] }
 *
 * Migration plan (this file is intentionally additive in PR 2):
 *   1. Land alongside existing `apiGet`/`apiPost` helpers in `lib/api.ts`.
 *   2. PR 3+ migrates one TanStack hook at a time from the old helpers
 *      to apiClient. Both keep working in parallel during the rollout.
 *   3. Eventually `lib/api.ts` becomes a thin compat layer or goes away.
 */

import { hc } from 'hono/client'
// Type-only import: stripped at compile time, no server runtime in the bundle.
import type { AppType } from 'server/src/app'

import { isApiErrorEnvelope, type ApiErrorEnvelope } from '@spanlens/api-types'

/**
 * Resolves the API origin for the typed client. Mirrors `lib/api.ts`'s
 * fallback chain so a Vercel preview deployment, a local dev, and a
 * production build all pick the same backend the rest of the dashboard
 * uses.
 */
function resolveBaseUrl(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    // SSR'd page rendered in the browser: prefer the explicit env so the
    // client does not accidentally talk to its own Next server.
    return process.env.NEXT_PUBLIC_API_URL ?? window.location.origin
  }
  return process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'
}

export const apiClient = hc<AppType>(resolveBaseUrl())

/**
 * Domain-specific error class thrown when a Hono RPC call returns a
 * non-2xx whose body matches the `ApiErrorEnvelope` shape. Carries the
 * structured fields so consumers can branch on `error.code`.
 *
 * Why not just bubble the raw envelope: every TanStack hook then needs
 * its own narrowing logic and `instanceof Error` checks fall through to
 * a generic 500 toast. A typed Error subclass is the one shape React
 * Query, Sentry, and the existing toast utility all already understand.
 */
export class SpanlensApiError extends Error {
  public readonly code: string
  public readonly status: number
  public readonly details: Record<string, unknown> | undefined
  public readonly requestId: string | null

  constructor(envelope: ApiErrorEnvelope, status: number) {
    super(envelope.error.message)
    this.name = 'SpanlensApiError'
    this.code = envelope.error.code
    this.status = status
    this.details = envelope.error.details
    this.requestId = envelope.error.requestId
  }
}

/**
 * Helper that inspects a Hono RPC `Response` and throws a typed
 * `SpanlensApiError` when the body matches the standard error envelope.
 * Returns the response unchanged on success so it composes cleanly:
 *
 *   const body = await throwIfApiError(await apiClient.api.v1.foo.$get())
 *
 * Non-envelope errors (HTML 502 from a CDN, network failure) reach the
 * caller as the original `fetch` failure so they can be handled with the
 * existing retry logic in TanStack Query.
 */
export async function throwIfApiError(res: Response): Promise<Response> {
  if (res.ok) return res
  // Clone so the caller can still read the body if they catch and want
  // the raw bytes.
  const cloned = res.clone()
  let parsed: unknown
  try {
    parsed = await cloned.json()
  } catch {
    return res
  }
  if (isApiErrorEnvelope(parsed)) {
    throw new SpanlensApiError(parsed, res.status)
  }
  return res
}
