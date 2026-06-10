/**
 * R-12 Phase 3.2 — per-organization events read switch.
 *
 * Resolves whether a given org's ClickHouse reads should hit the unified
 * `events` table (or its `events_as_requests` projection view) instead of
 * the legacy `requests` table. Two inputs, OR-composed per route family:
 *
 *   1. Env gates (`envUseEventsForRequests` / `Stats` / `Traces` from
 *      `feature-flags.ts`) — fleet-wide, double-gated on
 *      `EVENTS_BACKFILL_COMPLETE`, flips require a redeploy.
 *
 *   2. `organizations.read_from_events` (migration 20260610120000) —
 *      per-org, flips at runtime within the 30s cache TTL. This is the
 *      gradual-cutover lever for Phase 3.3 (dogfood -> 10% -> 50% -> 100%).
 *
 * The DB flag deliberately bypasses the backfill double-gate: setting it is
 * a targeted operator action on one org (after verifying that org's events
 * data), not a blunt env flip. The env gates keep their double-gate.
 *
 * The DB flag flips ALL THREE route families for the org at once — per-org
 * granularity is "which tenant", per-env granularity is "which route".
 * Mixing both axes per-org-per-route was considered and rejected: three
 * boolean columns invite drift and the cutover plan never needs it.
 *
 * Caching mirrors `getOrgPlan` (requests-query.ts): 30s TTL + in-flight
 * coalescing so a cold dashboard load costs one Supabase round-trip per
 * org, not one per concurrent query. Lookup failures resolve to `false`
 * (keep reading the legacy table) — the conservative direction while
 * `requests` remains the canonical store.
 */

import { supabaseAdmin } from './db.js'
import {
  envUseEventsForRequests,
  envUseEventsForStats,
  envUseEventsForTraces,
} from './feature-flags.js'

interface CachedFlag {
  value: boolean
  expiresAt: number
}

const READ_FLAG_CACHE_TTL_MS = 30 * 1000 // 30s — rollbacks take effect quickly
const flagCache = new Map<string, CachedFlag>()
const flagInflight = new Map<string, Promise<boolean>>()

/**
 * Raw DB flag lookup (cached). Exported for tests and the /health/deep
 * style diagnostics — route handlers should use the `useEventsForX`
 * wrappers below so the env OR is never forgotten.
 */
export async function orgReadsFromEvents(organizationId: string): Promise<boolean> {
  const cached = flagCache.get(organizationId)
  if (cached && cached.expiresAt > Date.now()) return cached.value

  const existing = flagInflight.get(organizationId)
  if (existing) return existing

  const fetchPromise = (async (): Promise<boolean> => {
    try {
      const { data, error } = await supabaseAdmin
        .from('organizations')
        .select('read_from_events')
        .eq('id', organizationId)
        .single()
      // Missing row, missing column (migration not yet applied), or any
      // lookup error all resolve to false — never flip an org onto the
      // events path by accident.
      const value = !error && data?.read_from_events === true
      flagCache.set(organizationId, {
        value,
        expiresAt: Date.now() + READ_FLAG_CACHE_TTL_MS,
      })
      return value
    } finally {
      flagInflight.delete(organizationId)
    }
  })()
  flagInflight.set(organizationId, fetchPromise)
  return fetchPromise
}

/** Test/escape hatch — flush cached values AND any in-flight fetch. */
export function resetOrgReadsFromEventsCache(): void {
  flagCache.clear()
  flagInflight.clear()
}

/** `/api/v1/requests` list — events read switch for this org. */
export async function useEventsForRequests(organizationId: string): Promise<boolean> {
  return envUseEventsForRequests || orgReadsFromEvents(organizationId)
}

/** Stats pipeline (`lib/stats-queries.ts`) — events read switch for this org. */
export async function useEventsForStats(organizationId: string): Promise<boolean> {
  return envUseEventsForStats || orgReadsFromEvents(organizationId)
}

/** `/api/v1/traces` list + detail — events read switch for this org. */
export async function useEventsForTraces(organizationId: string): Promise<boolean> {
  return envUseEventsForTraces || orgReadsFromEvents(organizationId)
}
