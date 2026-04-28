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
import { sendEmail, renderStaleKeyDigestEmail } from './resend.js'

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
  digests_sent: number
  total_stale_keys: number
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

  for (const key of keys) {
    // Look at the single most recent request for this key. The partial
    // index added in 20260428023000_security_settings.sql makes this an
    // index-only lookup.
    const { data: latest } = await supabaseAdmin
      .from('requests')
      .select('created_at')
      .eq('provider_key_id', key.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const lastUsedIso = latest?.created_at ?? null
    const referenceMs = lastUsedIso
      ? Date.parse(lastUsedIso)
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

/**
 * Resolve email addresses of all admin members for an org. Falls back
 * to the org owner if there are no admin rows (e.g. legacy single-user
 * workspaces created pre-multi-user migration).
 */
async function getAdminEmails(orgId: string): Promise<string[]> {
  const { data: members } = await supabaseAdmin
    .from('org_members')
    .select('user_id')
    .eq('organization_id', orgId)
    .eq('role', 'admin')

  const userIds = (members ?? []).map((m) => m.user_id)
  if (userIds.length === 0) return []

  const emails: string[] = []
  for (const userId of userIds) {
    const { data } = await supabaseAdmin.auth.admin.getUserById(userId)
    if (data?.user?.email) emails.push(data.user.email)
  }
  return emails
}

export async function runStaleKeyDigestJob(): Promise<StaleKeyDigestResult> {
  const result: StaleKeyDigestResult = {
    orgs_checked: 0,
    digests_sent: 0,
    total_stale_keys: 0,
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
        result.total_stale_keys += stale.length

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
