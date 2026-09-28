// ─────────────────────────────────────────────────────────────────────────────
// Email outbox for the past-due downgrade cron (quality audit 2026-09-28, C3.2).
//
// The old cron wrote a dedupe marker and THEN sent, so a failed send was
// never retried: the marker said "done". Now a marker row is an outbox entry:
//
//   pending ──claim──▶ send ──accepted──▶ sent
//                        └──failed──▶ pending (attempts + 1) … ▶ failed
//   pending ──no longer relevant / no recipient──▶ skipped
//
// A claim is a compare-and-set on `attempts` plus a lease on last_attempt_at,
// so two scheduler firings (gotcha #32) cannot both send, and a failed send
// is retried by the next daily run rather than by the second firing minutes
// later. Warnings are only sent while their delinquency cycle is still open;
// the downgrade notice is sent regardless (the downgrade already happened).
// ─────────────────────────────────────────────────────────────────────────────

import { supabaseAdmin } from './db.js'
import { sendEmail, renderPastDueEmail } from './resend.js'
import { logError } from './structured-logger.js'
import type { DowngradeRunResult, DowngradeStage } from './billing-downgrade.js'

const HOUR_MS = 60 * 60 * 1000
const MAX_ATTEMPTS = 5
/** At most one attempt per row per day, even with the scheduler firing twice. */
const CLAIM_LEASE_MS = 20 * HOUR_MS
/** A warning not delivered within this long is superseded by the next stage. */
const WARNING_TTL_MS = 36 * HOUR_MS
/** How far back the drain looks for undelivered rows. */
const DRAIN_LOOKBACK_MS = 7 * 24 * HOUR_MS
const DRAIN_BATCH = 100

const TABLE = 'billing_downgrade_notifications'

interface OutboxRow {
  id: string
  subscription_id: string
  stage: DowngradeStage
  cycle_started_at: string
  attempts: number
  created_at: string
  subscriptions: { organization_id: string; past_due_since: string | null } | null
}

type SkipReason = 'cycle closed' | 'expired' | 'no owner email' | 'email provider not configured'

/**
 * PostgREST returns a many-to-one embed as an object; the untyped client
 * types it as an array. Accept both rather than trusting either.
 */
function toOutboxRow(raw: unknown): OutboxRow {
  const row = raw as Omit<OutboxRow, 'subscriptions'> & { subscriptions?: unknown }
  const rel = row.subscriptions
  const subscription = (Array.isArray(rel) ? rel[0] : rel) as OutboxRow['subscriptions'] | undefined
  return { ...row, subscriptions: subscription ?? null }
}

function sameInstant(a: string | null, b: string | null): boolean {
  if (!a || !b) return false
  return Date.parse(a) === Date.parse(b)
}

/** Pure: should this row be dropped instead of sent? */
export function skipReasonFor(row: OutboxRow, now: Date): SkipReason | null {
  if (row.stage === 'downgraded') return null
  if (!row.subscriptions || !sameInstant(row.subscriptions.past_due_since, row.cycle_started_at)) {
    return 'cycle closed'
  }
  if (now.getTime() - Date.parse(row.created_at) > WARNING_TTL_MS) return 'expired'
  return null
}

export async function drainDowngradeNotifications(now: Date, result: DowngradeRunResult): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select('id, subscription_id, stage, cycle_started_at, attempts, created_at, subscriptions(organization_id, past_due_since)')
    .eq('status', 'pending')
    .not('cycle_started_at', 'is', null)
    .lt('attempts', MAX_ATTEMPTS)
    .gt('created_at', new Date(now.getTime() - DRAIN_LOOKBACK_MS).toISOString())
    .order('created_at', { ascending: true })
    .limit(DRAIN_BATCH)

  if (error) {
    result.errors.push(`select pending notifications failed: ${error.message}`)
    return
  }

  for (const row of ((data ?? []) as unknown[]).map(toOutboxRow)) {
    try {
      await deliver(row, now, result)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logError('CRON_PARTIAL_FAILURE', {
        jobName: 'check-past-due-downgrades',
        notificationId: row.id,
        stage: row.stage,
      }, err)
      result.errors.push(`notification ${row.id}: ${message}`)
    }
  }
}

async function deliver(row: OutboxRow, now: Date, result: DowngradeRunResult): Promise<void> {
  const skip = skipReasonFor(row, now)
  if (skip) {
    await finish(row.id, { status: 'skipped', last_error: skip })
    return
  }

  if (!(await claim(row, now))) return
  const attempts = row.attempts + 1

  const orgId = row.subscriptions?.organization_id
  const recipient = orgId ? await fetchOwner(orgId) : null
  if (!recipient?.owner) {
    await finish(row.id, { status: 'skipped', last_error: 'no owner email' })
    return
  }

  const webUrl = process.env['WEB_URL'] ?? 'https://www.spanlens.io'
  const { subject, html } = renderPastDueEmail({
    orgName: recipient.orgName,
    stage: row.stage,
    pastDueSince: row.cycle_started_at,
    billingUrl: `${webUrl}/billing`,
  })
  const outcome = await send(recipient.owner, subject, html)

  if (outcome.kind === 'sent') {
    await finish(row.id, { status: 'sent', sent_at: now.toISOString(), last_error: null })
    countSent(row.stage, result)
    return
  }
  if (outcome.kind === 'disabled') {
    await finish(row.id, { status: 'skipped', last_error: 'email provider not configured' })
    return
  }

  result.emailsFailed += 1
  result.errors.push(`notification ${row.id}: send failed: ${outcome.error}`)
  await finish(row.id, {
    status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
    last_error: outcome.error,
  })
}

function countSent(stage: DowngradeStage, result: DowngradeRunResult): void {
  if (stage === 'warning-d3') result.warningsD3 += 1
  else if (stage === 'warning-d1') result.warningsD1 += 1
  else result.downgradeNoticesSent += 1
}

/** CAS on attempts + lease: true only for the caller that won this attempt. */
async function claim(row: OutboxRow, now: Date): Promise<boolean> {
  const leaseCutoff = new Date(now.getTime() - CLAIM_LEASE_MS).toISOString()
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .update({ attempts: row.attempts + 1, last_attempt_at: now.toISOString() })
    .eq('id', row.id)
    .eq('status', 'pending')
    .eq('attempts', row.attempts)
    .or(`last_attempt_at.is.null,last_attempt_at.lt."${leaseCutoff}"`)
    .select('id')
  if (error) throw new Error(`claim failed: ${error.message}`)
  return ((data ?? []) as unknown[]).length === 1
}

async function finish(id: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await supabaseAdmin.from(TABLE).update(patch).eq('id', id)
  if (error) throw new Error(`update to ${String(patch['status'])} failed: ${error.message}`)
}

type SendOutcome = { kind: 'sent' } | { kind: 'disabled' } | { kind: 'failed'; error: string }

async function send(to: string, subject: string, html: string): Promise<SendOutcome> {
  try {
    const res = await sendEmail({ to, subject, html })
    if (res.sent) return { kind: 'sent' }
    // sendEmail returns { sent: false } without an error only in the dev
    // fallback (RESEND_API_KEY unset): nothing to retry.
    return res.error ? { kind: 'failed', error: res.error } : { kind: 'disabled' }
  } catch (err) {
    return { kind: 'failed', error: err instanceof Error ? err.message : String(err) }
  }
}

async function fetchOwner(organizationId: string): Promise<{ owner: string | null; orgName: string }> {
  // owner_id lives on organizations (NOT NULL). The org_role enum has no
  // 'owner' value, so org_members cannot answer this.
  const { data: org, error } = await supabaseAdmin
    .from('organizations')
    .select('name, owner_id')
    .eq('id', organizationId)
    .single()
  if (error) throw new Error(`owner lookup failed: ${error.message}`)

  const orgName = (org as { name?: string } | null)?.name ?? organizationId
  const ownerId = (org as { owner_id?: string | null } | null)?.owner_id
  if (!ownerId) return { owner: null, orgName }

  const { data, error: userError } = await supabaseAdmin.auth.admin.getUserById(ownerId)
  if (userError) throw new Error(`owner lookup failed: ${userError.message}`)
  return { owner: data.user?.email ?? null, orgName }
}
