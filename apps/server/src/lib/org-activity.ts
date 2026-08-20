import { supabaseAdmin } from './db.js'

/**
 * Per-org "when did we last log a request" watermark, so a cron can tell
 * whether an organization has anything new before it queries `requests`.
 *
 * Most of what the cron fleet asks is a foregone conclusion: the question is
 * about an organization that has sent nothing since the last run. This table
 * answers that from one indexed row per org, where the same question put to
 * `requests` is an aggregate over the log itself. With most tenants idle most
 * of the time, that is the difference between a cron tick costing one small
 * lookup and one costing a scan per tenant.
 *
 * Everything here fails OPEN. If the watermark cannot be read we report
 * "assume active" and the caller runs its full query exactly as it would
 * without the gate. A stale watermark must never be able to suppress a real
 * alert or a real usage rollup; the worst acceptable failure is one wasted
 * scan. This also makes the deploy ordering safe: if the code ships ahead of
 * the migration (CLAUDE.md gotcha #25), the missing table degrades to the
 * ungated behaviour rather than to silence.
 */

/**
 * How long one process reuses a previous write for the same org before
 * issuing another UPSERT. Bounds the write amplification on the logging
 * path to one row per org per minute per instance. Gates read windows of
 * 15 minutes and up, so a watermark that lags by under a minute cannot
 * change a decision.
 */
const WRITE_THROTTLE_MS = 60_000

/**
 * Cap on the throttle map. Serverless instances are short-lived so this
 * rarely fills; the cap exists so a long-lived container serving many
 * tenants cannot grow the map without bound.
 */
const THROTTLE_MAX_ENTRIES = 1000

const lastWriteByOrg = new Map<string, number>()

/** Test seam — module state would otherwise leak between cases. */
export function resetOrgActivityThrottle(): void {
  lastWriteByOrg.clear()
}

/**
 * Stamp `organizationId` as active now. Called from the request logging
 * path after the `requests` row lands. Never throws: losing a
 * watermark write costs at most one skipped cron cycle for that org, and
 * must not be able to fail a request that already succeeded.
 */
export async function recordOrgActivity(organizationId: string): Promise<void> {
  if (!organizationId) return

  const now = Date.now()
  const last = lastWriteByOrg.get(organizationId)
  if (last != null && now - last < WRITE_THROTTLE_MS) return

  if (lastWriteByOrg.size >= THROTTLE_MAX_ENTRIES) lastWriteByOrg.clear()
  lastWriteByOrg.set(organizationId, now)

  try {
    const stamp = new Date(now).toISOString()
    const { error } = await supabaseAdmin
      .from('org_activity')
      .upsert(
        { organization_id: organizationId, last_request_at: stamp, updated_at: stamp },
        { onConflict: 'organization_id' },
      )
    if (error) {
      // Drop the throttle entry so the next request retries instead of
      // waiting out the window on a write that never landed.
      lastWriteByOrg.delete(organizationId)
      console.error(`[org-activity] upsert failed for ${organizationId}: ${error.message}`)
    }
  } catch (err) {
    lastWriteByOrg.delete(organizationId)
    console.error(`[org-activity] upsert failed for ${organizationId}:`, err)
  }
}

/**
 * Last-request timestamp (epoch ms) per organization, for orgs active at or
 * after `since`. `null` means the watermark could not be read, and callers
 * must then treat every org as active — see the fail-open note at the top.
 *
 * Callers fetch once with the widest window they care about and then narrow
 * per item via `orgActiveSince`, so a loop over N alerts costs one query
 * rather than N.
 */
export type OrgActivityMap = Map<string, number>

export async function getOrgActivitySince(since: Date): Promise<OrgActivityMap | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from('org_activity')
      .select('organization_id, last_request_at')
      .gte('last_request_at', since.toISOString())

    if (error) {
      console.error(`[org-activity] active-since lookup failed: ${error.message}`)
      return null
    }

    const map: OrgActivityMap = new Map()
    for (const row of (data ?? []) as Array<{ organization_id: string; last_request_at: string }>) {
      const ms = Date.parse(row.last_request_at)
      if (!Number.isNaN(ms)) map.set(row.organization_id, ms)
    }
    return map
  } catch (err) {
    console.error('[org-activity] active-since lookup failed:', err)
    return null
  }
}

/**
 * Whether the org logged a request at or after `since`, given a map from
 * `getOrgActivitySince`. Centralises the "`null` means assume active" rule
 * so no caller can forget it.
 */
export function orgActiveSince(
  activity: OrgActivityMap | null,
  organizationId: string,
  since: Date,
): boolean {
  if (activity === null) return true
  const lastMs = activity.get(organizationId)
  return lastMs != null && lastMs >= since.getTime()
}

/**
 * Whether ANY organization logged a request at or after `since`. Used by the
 * cross-tenant crons, which have no per-org loop to gate. Fails open to true.
 */
export async function anyActivitySince(since: Date): Promise<boolean> {
  try {
    const { data, error } = await supabaseAdmin
      .from('org_activity')
      .select('organization_id')
      .gte('last_request_at', since.toISOString())
      .limit(1)

    if (error) {
      console.error(`[org-activity] any-activity lookup failed: ${error.message}`)
      return true
    }
    return (data ?? []).length > 0
  } catch (err) {
    console.error('[org-activity] any-activity lookup failed:', err)
    return true
  }
}
