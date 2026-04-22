import { supabaseAdmin } from './db.js'
import { MONTHLY_REQUEST_LIMITS, type Plan } from './quota.js'
import { sendQuotaWarningEmail } from './notifiers.js'
import { decideQuotaWarning, currentMonthStartMs } from './quota-warnings-stats.js'

/**
 * Quota warning emails at 80% / 100% of the monthly request limit.
 *
 * Runs on an hourly cron. For each eligible org (plan with a finite limit),
 * computes this-UTC-calendar-month usage, decides whether to send based on
 * prior send timestamps, sends via Resend, updates the timestamp on success.
 *
 * Idempotency strategy: per-month per-threshold. If the cron already sent
 * the 80% warning this month, it won't send again until the calendar month
 * rolls over — at which point the stored timestamp sits before the new
 * month start, and `decideQuotaWarning` returns true again.
 *
 * Hard-enforcement (429) already lives in the proxy middleware; this is
 * purely the "user-facing warning" path — the business value is the chance
 * to upgrade the plan before hitting the wall.
 *
 * Pure decision logic lives in `quota-warnings-stats.ts` so the test suite
 * can import it without triggering `db.ts` module initialization.
 */

// ── Service layer ──────────────────────────────────────────────────────

interface OrgRow {
  id: string
  name: string
  plan: Plan
  owner_id: string
  allow_overage: boolean
  overage_cap_multiplier: number
  quota_warning_80_sent_at: string | null
  quota_warning_100_sent_at: string | null
}

export interface QuotaWarningRunResult {
  checked: number
  sent80: number
  sent100: number
  errors: number
}

/**
 * Iterate all orgs with a finite monthly limit, decide, and send.
 */
export async function runQuotaWarningsJob(): Promise<QuotaWarningRunResult> {
  const nowMs = Date.now()
  const monthStartMs = currentMonthStartMs(new Date(nowMs))
  const monthStartIso = new Date(monthStartMs).toISOString()

  // Fetch all orgs on a plan with a finite limit. Enterprise has a null
  // limit (unlimited) so we skip them via the plan filter.
  const plansWithLimit = Object.entries(MONTHLY_REQUEST_LIMITS)
    .filter(([, limit]) => limit !== null)
    .map(([plan]) => plan)

  const { data: orgs, error } = await supabaseAdmin
    .from('organizations')
    .select(
      'id, name, plan, owner_id, allow_overage, overage_cap_multiplier, quota_warning_80_sent_at, quota_warning_100_sent_at',
    )
    .in('plan', plansWithLimit)
    .returns<OrgRow[]>()

  if (error || !orgs) {
    console.error('[quota-warnings] failed to list orgs:', error?.message)
    return { checked: 0, sent80: 0, sent100: 0, errors: 1 }
  }

  const result: QuotaWarningRunResult = { checked: 0, sent80: 0, sent100: 0, errors: 0 }

  for (const org of orgs) {
    result.checked++
    const limit = MONTHLY_REQUEST_LIMITS[org.plan]
    if (limit === null) continue // defensive: enterprise slipped past the filter

    // Count this org's requests this month — same source of truth the
    // proxy middleware uses for 429 enforcement.
    const { count, error: countErr } = await supabaseAdmin
      .from('requests')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', org.id)
      .gte('created_at', monthStartIso)

    if (countErr) {
      console.error(`[quota-warnings] count failed for org ${org.id}:`, countErr.message)
      result.errors++
      continue
    }

    const used = count ?? 0
    const ratio = used / limit

    const decision = decideQuotaWarning(
      ratio,
      monthStartMs,
      org.quota_warning_80_sent_at ? Date.parse(org.quota_warning_80_sent_at) : null,
      org.quota_warning_100_sent_at ? Date.parse(org.quota_warning_100_sent_at) : null,
    )
    if (!decision.send) continue

    // Resolve owner email via auth.users. Admin API — uses service role.
    const { data: userData, error: userErr } = await supabaseAdmin.auth.admin.getUserById(
      org.owner_id,
    )
    if (userErr || !userData?.user?.email) {
      console.error(
        `[quota-warnings] could not resolve owner email for org ${org.id}: ${userErr?.message ?? 'no email'}`,
      )
      result.errors++
      continue
    }

    // Pattern C: the message at 100% depends on whether overage is authorized.
    // `overageActive` = paid plan + allow_overage + within hard-cap band.
    const overageActive =
      org.plan !== 'free' &&
      org.allow_overage &&
      used < limit * org.overage_cap_multiplier

    const delivery = await sendQuotaWarningEmail(userData.user.email, {
      organizationName: org.name,
      threshold: decision.threshold!,
      used,
      limit,
      plan: org.plan,
      billingUrl: 'https://www.spanlens.io/billing',
      overageActive,
      hardCap: limit * org.overage_cap_multiplier,
    })

    if (!delivery.ok) {
      console.error(`[quota-warnings] email send failed for org ${org.id}:`, delivery.error)
      result.errors++
      continue
    }

    // Record the send. Update BOTH timestamps when crossing 100% so a later
    // run doesn't pointlessly send an 80% email after the org downsizes
    // traffic below 80% and then bumps back up.
    const patch: Record<string, string> =
      decision.threshold === 100
        ? {
            quota_warning_100_sent_at: new Date(nowMs).toISOString(),
            quota_warning_80_sent_at:
              org.quota_warning_80_sent_at ?? new Date(nowMs).toISOString(),
          }
        : { quota_warning_80_sent_at: new Date(nowMs).toISOString() }

    const { error: updateErr } = await supabaseAdmin
      .from('organizations')
      .update(patch)
      .eq('id', org.id)

    if (updateErr) {
      console.error(`[quota-warnings] timestamp update failed for org ${org.id}:`, updateErr.message)
      result.errors++
      continue
    }

    if (decision.threshold === 100) result.sent100++
    else result.sent80++
  }

  return result
}
