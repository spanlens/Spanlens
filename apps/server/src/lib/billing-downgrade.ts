// ─────────────────────────────────────────────────────────────────────────────
// Auto-downgrade orchestration for past-due subscriptions (P2.7).
//
// Lifecycle (driven by /cron/check-past-due-downgrades daily):
//
//   t = 0  →  Paddle webhook flips subscriptions.status to past_due.
//             paddleWebhook stamps `past_due_since = now()`.
//
//   t = 4d →  Cron sends D-3 warning email (3 days before downgrade).
//   t = 6d →  Cron sends D-1 warning email (1 day before downgrade).
//   t = 7d →  Cron flips organizations.plan to 'free', writes audit_logs,
//             emails the owner that the downgrade happened, and clears
//             past_due_since so a re-upgrade starts fresh.
//
// Retention impact: `quota.ts` already enforces 14-day retention for the
// Free plan via `requestsScope`, so the dashboard tightens automatically
// the moment the plan flips — no extra wiring needed.
//
// Idempotency: every email send writes to `billing_downgrade_notifications`
// with a unique (subscription_id, stage) constraint. If the cron retries
// (Vercel cron at-least-once delivery), we no-op on the second send.
// ─────────────────────────────────────────────────────────────────────────────

import { supabaseAdmin } from './db.js'
import { sendEmail, renderPastDueEmail } from './resend.js'

const DOWNGRADE_AFTER_DAYS = 7
const WARNING_D3_DAY = 4 // 7 - 3
const WARNING_D1_DAY = 6 // 7 - 1

export type DowngradeStage = 'warning-d3' | 'warning-d1' | 'downgraded'

export interface DowngradeRunResult {
  scanned: number
  warningsD3: number
  warningsD1: number
  downgraded: number
  emailsSkipped: number   // already-sent dedupe
  errors: string[]
}

interface PastDueRow {
  id: string
  organization_id: string
  past_due_since: string
  paddle_subscription_id: string | null
}

/**
 * Top-level entry point called by the cron. Scans all past_due
 * subscriptions and applies the appropriate stage to each. Per-row errors
 * don't abort the run — they're collected for logging.
 */
export async function runDowngradeCheck(): Promise<DowngradeRunResult> {
  const result: DowngradeRunResult = {
    scanned: 0,
    warningsD3: 0,
    warningsD1: 0,
    downgraded: 0,
    emailsSkipped: 0,
    errors: [],
  }

  const { data: rows, error } = await supabaseAdmin
    .from('subscriptions')
    .select('id, organization_id, past_due_since, paddle_subscription_id')
    .not('past_due_since', 'is', null)

  if (error) {
    result.errors.push(`select past_due rows failed: ${error.message}`)
    return result
  }

  const pastDueRows = (rows ?? []) as PastDueRow[]
  result.scanned = pastDueRows.length

  for (const row of pastDueRows) {
    try {
      const daysOverdue = daysSince(row.past_due_since)

      if (daysOverdue >= DOWNGRADE_AFTER_DAYS) {
        const did = await applyDowngrade(row)
        if (did) result.downgraded += 1
        else result.emailsSkipped += 1
      } else if (daysOverdue >= WARNING_D1_DAY) {
        const sent = await sendStageEmail(row, 'warning-d1')
        if (sent) result.warningsD1 += 1
        else result.emailsSkipped += 1
      } else if (daysOverdue >= WARNING_D3_DAY) {
        const sent = await sendStageEmail(row, 'warning-d3')
        if (sent) result.warningsD3 += 1
        else result.emailsSkipped += 1
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      result.errors.push(`org ${row.organization_id}: ${message}`)
    }
  }

  return result
}

// ── Internals ─────────────────────────────────────────────────────────────────

function daysSince(iso: string): number {
  const start = new Date(iso).getTime()
  const now = Date.now()
  return Math.floor((now - start) / (24 * 60 * 60 * 1000))
}

/**
 * Send a stage email, deduped against `billing_downgrade_notifications`.
 * Returns true if a new email was actually sent (or attempted), false if
 * a row already existed for (subscription, stage) — i.e. cron retry.
 */
async function sendStageEmail(row: PastDueRow, stage: DowngradeStage): Promise<boolean> {
  // De-dupe via a unique constraint on (paddle_subscription_id, stage).
  // We INSERT first; on conflict (row exists), the INSERT no-ops and we
  // skip the send. This makes the cron safely re-runnable.
  const { error: dedupeErr } = await supabaseAdmin
    .from('billing_downgrade_notifications')
    .insert({
      subscription_id: row.id,
      stage,
    })
  if (dedupeErr) {
    // 23505 = unique_violation. Anything else is unexpected and we should
    // still try to send — losing dedup is better than missing a warning.
    if ((dedupeErr as { code?: string }).code === '23505') {
      return false
    }
  }

  const { owner, orgName } = await fetchOwner(row.organization_id)
  if (!owner) return false

  const webUrl = process.env['WEB_URL'] ?? 'https://www.spanlens.io'
  const { subject, html } = renderPastDueEmail({
    orgName,
    stage,
    pastDueSince: row.past_due_since,
    billingUrl: `${webUrl}/billing`,
  })
  const sendResult = await sendEmail({ to: owner, subject, html })
  if (!sendResult.sent && sendResult.error) {
    console.error('[downgrade] email send failed:', sendResult.error)
  }
  return true
}

/**
 * Move the org to the Free plan, audit-log it, email the owner, and clear
 * past_due_since so future failures restart the clock.
 *
 * Idempotent via the same `billing_downgrade_notifications` dedupe — if a
 * row for stage='downgraded' already exists, we treat it as already done.
 */
async function applyDowngrade(row: PastDueRow): Promise<boolean> {
  const { error: dedupeErr } = await supabaseAdmin
    .from('billing_downgrade_notifications')
    .insert({ subscription_id: row.id, stage: 'downgraded' })
  if (dedupeErr && (dedupeErr as { code?: string }).code === '23505') {
    return false
  }

  // 1. Flip the plan
  await supabaseAdmin
    .from('organizations')
    .update({ plan: 'free' })
    .eq('id', row.organization_id)

  // 2. Clear past_due_since on the subscription (so a re-upgrade starts fresh).
  await supabaseAdmin
    .from('subscriptions')
    .update({ past_due_since: null })
    .eq('id', row.id)

  // 3. Audit log
  await supabaseAdmin.from('audit_logs').insert({
    organization_id: row.organization_id,
    user_id: null, // system action
    action: 'billing.plan.auto_downgrade',
    resource_type: 'organization',
    resource_id: row.organization_id,
    metadata: {
      reason: 'past_due_7_days',
      past_due_since: row.past_due_since,
      paddle_subscription_id: row.paddle_subscription_id,
    },
  })

  // 4. Email the owner
  const { owner, orgName } = await fetchOwner(row.organization_id)
  if (owner) {
    const webUrl = process.env['WEB_URL'] ?? 'https://www.spanlens.io'
    const { subject, html } = renderPastDueEmail({
      orgName,
      stage: 'downgraded',
      pastDueSince: row.past_due_since,
      billingUrl: `${webUrl}/billing`,
    })
    await sendEmail({ to: owner, subject, html }).catch((err: unknown) => {
      console.error('[downgrade] post-downgrade email failed:', err)
    })
  }

  return true
}

async function fetchOwner(organizationId: string): Promise<{
  owner: string | null
  orgName: string
}> {
  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('name')
    .eq('id', organizationId)
    .single()

  const { data: members } = await supabaseAdmin
    .from('org_members')
    .select('user_id')
    .eq('organization_id', organizationId)
    .eq('role', 'owner')
    .limit(1)

  const ownerId = members?.[0]?.user_id
  if (!ownerId) return { owner: null, orgName: (org?.name as string | undefined) ?? organizationId }

  const { data: { user } } = await supabaseAdmin.auth.admin.getUserById(ownerId)
  return {
    owner: user?.email ?? null,
    orgName: (org?.name as string | undefined) ?? organizationId,
  }
}
