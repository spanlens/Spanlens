/**
 * Daily provider-key leak detection job.
 *
 * Pipeline per active provider_key (when org has leak_detection_enabled):
 *   1. Skip if already scanned within the last 24h (rate-limit + cost guard).
 *   2. Decrypt the key in-memory (never logged, never persisted plaintext).
 *   3. Hash + send 5-char SHA-256 prefix to GitGuardian HMSL.
 *   4. Insert provider_key_leak_scans row with the result.
 *   5. On `leaked` → email admins, but ONLY if the previous scan for this
 *      key wasn't already a leaked-and-notified row (avoid daily spam).
 *
 * Notification-only: we never call UPDATE on provider_keys.is_active.
 * Admins decide whether to revoke from the dashboard.
 */

import { supabaseAdmin } from './db.js'
import { aes256Decrypt } from './crypto.js'
import { checkSecretLeaked } from './gitguardian.js'
import { sendEmail, renderLeakAlertEmail } from './resend.js'
import { getAdminEmails } from './admin-emails.js'

export interface LeakDetectionResult {
  orgs_checked: number
  keys_scanned: number
  newly_leaked: number
  errors: string[]
}

interface ProviderKeyRow {
  id: string
  organization_id: string
  name: string
  provider: string
  encrypted_key: string
}

interface LastScan {
  result: 'clean' | 'leaked' | 'error'
  notified_at: string | null
  scanned_at: string
}

const RATE_LIMIT_DELAY_MS = 1500 // ~40 req/min, comfortably under HMSL's 50/min cap

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Most-recent scan for a given key. Used to dedupe alert emails when a
 * key has been flagged-and-emailed once already — we re-record the scan
 * (so dashboards stay current) but skip the email.
 */
async function loadLastScan(providerKeyId: string): Promise<LastScan | null> {
  const { data } = await supabaseAdmin
    .from('provider_key_leak_scans')
    .select('result, notified_at, scanned_at')
    .eq('provider_key_id', providerKeyId)
    .order('scanned_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as LastScan | null) ?? null
}

export async function runLeakDetectionJob(): Promise<LeakDetectionResult> {
  const result: LeakDetectionResult = {
    orgs_checked: 0,
    keys_scanned: 0,
    newly_leaked: 0,
    errors: [],
  }

  if (!process.env['GITGUARDIAN_API_KEY']) {
    result.errors.push('GITGUARDIAN_API_KEY not configured — skipping')
    return result
  }

  const dashboardBase = process.env['WEB_URL'] ?? 'https://www.spanlens.io'

  const { data: orgs, error: orgErr } = await supabaseAdmin
    .from('organizations')
    .select('id, name')
    .eq('leak_detection_enabled', true)

  if (orgErr) {
    result.errors.push(`failed to list orgs: ${orgErr.message}`)
    return result
  }

  for (const org of orgs ?? []) {
    result.orgs_checked++

    const { data: keys, error: keyErr } = await supabaseAdmin
      .from('provider_keys')
      .select('id, organization_id, name, provider, encrypted_key')
      .eq('organization_id', org.id)
      .eq('is_active', true)

    if (keyErr) {
      result.errors.push(`org ${org.id}: ${keyErr.message}`)
      continue
    }

    for (const key of (keys ?? []) as ProviderKeyRow[]) {
      // Dedup: skip keys already scanned in the last 24h regardless of outcome.
      const last = await loadLastScan(key.id)
      const cutoffMs = Date.now() - 24 * 60 * 60 * 1000
      if (last && Date.parse(last.scanned_at) >= cutoffMs) continue

      result.keys_scanned++

      // Decrypt → hash → HMSL. Plaintext is held in a single `let`
      // and overwritten the moment the HMSL call resolves — never logged.
      let plaintext = ''
      let scanResult: 'clean' | 'leaked' | 'error' = 'error'
      let details: Record<string, unknown> = {}

      try {
        plaintext = await aes256Decrypt(key.encrypted_key)
        if (!plaintext) {
          throw new Error('decryption returned empty string (ENCRYPTION_KEY mismatch?)')
        }

        const outcome = await checkSecretLeaked(plaintext)
        scanResult = outcome.leaked ? 'leaked' : 'clean'
        details = outcome.details
      } catch (err) {
        details = { error: err instanceof Error ? err.message : 'unknown' }
        result.errors.push(`key ${key.id}: ${details['error'] as string}`)
      } finally {
        // Defensive: clear plaintext from the closure ASAP. JS GC will
        // eventually reclaim it, but explicit overwrite shortens the window.
        plaintext = ''
      }

      // Only email when this scan flips to leaked AND we haven't already
      // notified for the previous leaked scan. Re-flag-and-resend after
      // a clean scan in between is fine and intended — that means the
      // user revoked + reissued, then the new key got leaked too.
      const shouldNotify =
        scanResult === 'leaked' &&
        !(last?.result === 'leaked' && last.notified_at !== null)

      let notifiedAt: string | null = null
      if (shouldNotify) {
        const recipients = await getAdminEmails(key.organization_id)
        const emailRendered = renderLeakAlertEmail({
          orgName: org.name,
          keyName: key.name,
          provider: key.provider,
          detectedAt: new Date().toISOString(),
          dashboardUrl: `${dashboardBase}/settings?tab=api-keys`,
        })

        let sentToOne = false
        for (const to of recipients) {
          const r = await sendEmail({ to, ...emailRendered })
          if (r.sent) sentToOne = true
        }
        if (sentToOne) {
          notifiedAt = new Date().toISOString()
          result.newly_leaked++

          await supabaseAdmin.from('audit_logs').insert({
            organization_id: key.organization_id,
            action: 'security.provider_key.leaked_alert',
            resource_type: 'provider_key',
            resource_id: key.id,
            metadata: { provider: key.provider, recipients: recipients.length },
          })
        }
      }

      await supabaseAdmin.from('provider_key_leak_scans').insert({
        provider_key_id: key.id,
        organization_id: key.organization_id,
        result: scanResult,
        notified_at: notifiedAt,
        details,
      })

      // Stay under HMSL's 50/min ceiling regardless of how fast we are.
      await sleep(RATE_LIMIT_DELAY_MS)
    }
  }

  return result
}
