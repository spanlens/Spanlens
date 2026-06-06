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
 */

function envBool(name: string): boolean {
  return process.env[name] === '1'
}

/**
 * Phase 5.1 Stage 3 — when set, `/api/v1/requests` reads from the
 * new unified `events` table (event_type='generation') instead of
 * `requests`. Turning the flag off must remain a safe operation that
 * falls all the way back to the original code path; we don't drop
 * `requests` writes until Stage 4 (post-cutover).
 *
 * Activation env var: `USE_EVENTS_FOR_REQUESTS=1`
 */
export const useEventsForRequests = envBool('USE_EVENTS_FOR_REQUESTS')

/** Diagnostics view — used by `/health/deep` to surface what's on. */
export function snapshotFlags(): Record<string, boolean> {
  return {
    USE_EVENTS_FOR_REQUESTS: useEventsForRequests,
  }
}
