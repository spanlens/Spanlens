/**
 * Server-side feature flags.
 *
 * Env-var-backed boolean toggles read once at module load. Two design
 * choices worth flagging:
 *
 *   1. Read at module load (not per-call) — flips require a redeploy
 *      to take effect. We accept that cost for the operational simplicity
 *      of "no live wire to the flag service". When we need at-runtime
 *      flips for a specific feature we'll wire that flag into Upstash
 *      or LaunchDarkly individually.
 *
 *   2. Strict truthy check — only the literal string "1" enables a
 *      flag. We reject "true" / "TRUE" / "yes" to keep behaviour
 *      identical across dev machines, CI, and production. A missing
 *      var is always disabled.
 *
 * Add new flags as exported constants here so a `git grep` from a code
 * review finds every flag the server reads.
 *
 * NOTE (R-12 Phase 3.2): the constants below are the ENV side only.
 * The per-organization read switch (`organizations.read_from_events`)
 * lives in `lib/events-read-flag.ts`, which composes these constants
 * with a cached DB lookup. Route handlers should call THOSE async
 * functions, not these constants directly.
 */

function envBool(name: string): boolean {
  return process.env[name] === '1'
}

/**
 * Phase 5.1 Stage 3 / R-12 Phase 3.2 — per-route env gates for reading
 * from the unified `events` table instead of `requests`.
 *
 * Each route family gets its own activation var so the cutover can be
 * staged route-by-route:
 *
 *   - `USE_EVENTS_FOR_REQUESTS=1` — `/api/v1/requests` list reads
 *   - `USE_EVENTS_FOR_STATS=1`    — stats pipeline (`lib/stats-queries.ts`)
 *   - `USE_EVENTS_FOR_TRACES=1`   — `/api/v1/traces` list + detail
 *
 * Operational guard: all three also require `EVENTS_BACKFILL_COMPLETE=1`.
 * Activating a read switch BEFORE the backfill finishes shows an empty
 * list to the operator (events only has rows from the dual-write start
 * onward, so 99% of `requests` is missing). Production hit this footgun
 * once already during the rollout — the double-gate prevents an env-flip
 * from going live without the matching "I confirmed the backfill"
 * acknowledgement.
 *
 * Turning a flag off must remain a safe operation that falls all the
 * way back to the original code path; we don't drop `requests` writes
 * until Phase 4 (post-cutover).
 */
export const envUseEventsForRequests =
  envBool('USE_EVENTS_FOR_REQUESTS') && envBool('EVENTS_BACKFILL_COMPLETE')

export const envUseEventsForStats =
  envBool('USE_EVENTS_FOR_STATS') && envBool('EVENTS_BACKFILL_COMPLETE')

export const envUseEventsForTraces =
  envBool('USE_EVENTS_FOR_TRACES') && envBool('EVENTS_BACKFILL_COMPLETE')

/** Diagnostics view — used by `/health/deep` to surface what's on. */
export function snapshotFlags(): Record<string, boolean> {
  return {
    USE_EVENTS_FOR_REQUESTS: envBool('USE_EVENTS_FOR_REQUESTS'),
    USE_EVENTS_FOR_STATS: envBool('USE_EVENTS_FOR_STATS'),
    USE_EVENTS_FOR_TRACES: envBool('USE_EVENTS_FOR_TRACES'),
    EVENTS_BACKFILL_COMPLETE: envBool('EVENTS_BACKFILL_COMPLETE'),
    /** The composed env gates the per-org resolver ORs with the DB flag. */
    envUseEventsForRequests,
    envUseEventsForStats,
    envUseEventsForTraces,
  }
}
