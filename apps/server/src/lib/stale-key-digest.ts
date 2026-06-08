/**
 * Weekly digest of provider keys that have been idle past the org's
 * configured threshold. Notification-only — no auto-revoke. Sent only
 * when the org has stale_key_alerts_enabled = true AND there's at least
 * one stale key (no "you have zero stale keys" emails).
 *
 * Idempotency: digests are weekly and best-effort — if the cron fires
 * twice (e.g. due to a Vercel retry) we may send the same digest twice.
 * That's acceptable for a recommendation email; tracking per-key
 * notified_at would balloon schema for ~zero benefit.
 */

import { supabaseAdmin } from './db.js'
import { unscopedClickhouse } from './clickhouse.js'
import { sendEmail, renderStaleKeyDigestEmail } from './resend.js'
import { getAdminEmails } from './admin-emails.js'

interface StaleKey {
  id: string
  name: string
  provider: string
  /** Last time this key was used to make a request. null = never used. */
  last_used_at: string | null
  /** Used as the floor for "stale" checks when last_used_at is null. */
  created_at: string
}

export interface StaleKeyDigestResult {
  orgs_checked: number
  /** Orgs where at least one stale key was detected (regardless of email outcome). */
  orgs_with_stale_keys: number
  /** Stale keys found across all orgs. Detection counter — NOT delivery. */
  stale_keys_detected: number
  /** Orgs where Resend reported a successful send. Stays 0 when RESEND_API_KEY is unset (dev fallback). */
  digests_sent: number
  errors: string[]
}

/**
 * Find all active provider_keys for an org that haven't been used in
 * `thresholdDays` days. A key with zero requests is considered stale if
 * its `created_at` is older than the threshold.
 */
async function findStaleKeysForOrg(
  orgId: string,
  thresholdDays: number,
): Promise<StaleKey[]> {
  const { data: keys } = await supabaseAdmin
    .from('provider_keys')
    .select('id, name, provider, created_at')
    .eq('organization_id', orgId)
    .eq('is_active', true)

  if (!keys || keys.length === 0) return []

  const cutoffMs = Date.now() - thresholdDays * 24 * 60 * 60 * 1000
  const stale: StaleKey[] = []

  // Bulk-fetch last-used per provider_key in one ClickHouse round-trip rather
  // than one per key. ignoreRetention is implicit here — we want to know about
  // stale keys regardless of plan retention (a key idle for 1 year is still
  // stale even on a 14-day Free plan).
  const keyIds = keys.map((k) => k.id)
  const lastUsedMap = new Map<string, string>()
  if (keyIds.length > 0) {
    try {
      const result = await unscopedClickhouse().query({
        query:
          'SELECT provider_key_id AS id, max(created_at) AS last_used_at ' +
          'FROM requests ' +
          'WHERE organization_id = {orgId:UUID} ' +
          '  AND provider_key_id IN {keyIds:Array(UUID)} ' +
          'GROUP BY provider_key_id',
        query_params: { orgId, keyIds },
        format: 'JSONEachRow',
      })
      const rows = (await result.json()) as Array<{ id: string; last_used_at: string }>
      for (const row of rows) lastUsedMap.set(row.id, row.last_used_at)
    } catch (err) {
      // Fall through — every key reports its created_at as the reference,
      // which conservatively marks idle keys as stale.
      console.error(
        '[stale-key-digest] ClickHouse last-used lookup failed:',
        err instanceof Error ? err.message : err,
      )
    }
  }

  for (const key of keys) {
    const lastUsedIso = lastUsedMap.get(key.id) ?? null
    const referenceMs = lastUsedIso
      ? Date.parse(lastUsedIso.replace(' ', 'T') + 'Z')
      : Date.parse(key.created_at)

    if (referenceMs < cutoffMs) {
      stale.push({
        id: key.id,
        name: key.name,
        provider: key.provider,
        last_used_at: lastUsedIso,
        created_at: key.created_at,
      })
    }
  }

  // Oldest first — surfaces the most-likely-deletable keys at the top.
  stale.sort((a, b) => {
    const aMs = a.last_used_at ? Date.parse(a.last_used_at) : Date.parse(a.created_at)
    const bMs = b.last_used_at ? Date.parse(b.last_used_at) : Date.parse(b.created_at)
    return aMs - bMs
  })

  return stale
}

export async function runStaleKeyDigestJob(): Promise<StaleKeyDigestResult> {
  const result: StaleKeyDigestResult = {
    orgs_checked: 0,
    orgs_with_stale_keys: 0,
    stale_keys_detected: 0,
    digests_sent: 0,
    errors: [],
  }

  const { data: orgs, error } = await supabaseAdmin
    .from('organizations')
    .select('id, name, stale_key_threshold_days')
    .eq('stale_key_alerts_enabled', true)

  if (error) {
    result.errors.push(`failed to list orgs: ${error.message}`)
    return result
  }

  const dashboardBase = process.env['WEB_URL'] ?? 'https://www.spanlens.io'

  for (const org of orgs ?? []) {
    result.orgs_checked++

    try {
      const stale = await findStaleKeysForOrg(org.id, org.stale_key_threshold_days)
      if (stale.length === 0) continue

      // Count detection up-front so dev fallback (no RESEND_API_KEY) and
      // post-cron observability still reflect what was found.
      result.orgs_with_stale_keys++
      result.stale_keys_detected += stale.length

      const recipients = await getAdminEmails(org.id)
      if (recipients.length === 0) {
        result.errors.push(`no admin recipients for org ${org.id}`)
        continue
      }

      const { subject, html } = renderStaleKeyDigestEmail({
        orgName: org.name,
        thresholdDays: org.stale_key_threshold_days,
        keys: stale,
        dashboardUrl: `${dashboardBase}/settings?tab=api-keys`,
      })

      let sentToAtLeastOne = false
      for (const to of recipients) {
        const r = await sendEmail({ to, subject, html })
        if (r.sent) sentToAtLeastOne = true
      }

      if (sentToAtLeastOne) {
        result.digests_sent++

        await supabaseAdmin.from('audit_logs').insert({
          organization_id: org.id,
          action: 'security.stale_key_digest_sent',
          resource_type: 'organization',
          resource_id: org.id,
          metadata: { keys: stale.length, recipients: recipients.length },
        })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown'
      result.errors.push(`org ${org.id}: ${msg}`)
    }
  }

  return result
}
