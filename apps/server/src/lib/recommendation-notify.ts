import { supabaseAdmin } from './db.js'
import { recommendModelSwaps } from './model-recommend.js'

/**
 * High-confidence recommendation email alerts.
 *
 * Thresholds (mirrors the UI's "high" confidence band):
 *   ≥ $40/mo projected savings  AND  ≥ 100 samples in the window.
 *
 * Idempotency: uses recommendation_notifications UNIQUE
 * (organization_id, recommendation_key) so each (org, swap pair) is
 * notified at most once regardless of cron re-runs.
 */

const HIGH_CONFIDENCE_MIN_SAVINGS = 40
const HIGH_CONFIDENCE_MIN_SAMPLES = 100
const ANALYSIS_HOURS = 24 * 7 // same default window as the UI

function makeRecKey(
  provider: string,
  model: string,
  suggestedProvider: string,
  suggestedModel: string,
): string {
  return `${provider}/${model}->${suggestedProvider}/${suggestedModel}`
}

interface OrgRow {
  id: string
  name: string
  owner_id: string
}

export interface RecommendNotifyResult {
  orgId: string
  sent: number
  skipped: number
  errors: string[]
}

/**
 * Sends a plain-text email listing all new high-confidence recommendations.
 * Returns { ok, error } for the caller to log.
 */
async function sendRecommendationAlert(
  toEmail: string,
  orgName: string,
  recommendations: Array<{
    currentProvider: string
    currentModel: string
    suggestedProvider: string
    suggestedModel: string
    estimatedMonthlySavingsUsd: number
    sampleCount: number
  }>,
  dashboardUrl: string,
): Promise<{ ok: boolean; error?: string }> {
  const apiKey = process.env['RESEND_API_KEY']
  if (!apiKey) return { ok: false, error: 'RESEND_API_KEY not configured' }

  const fromAddress = process.env['RESEND_FROM'] ?? 'alerts@spanlens.io'

  const recList = recommendations
    .map(
      (r) =>
        `  • ${r.currentProvider}/${r.currentModel} → ${r.suggestedProvider}/${r.suggestedModel}` +
        `\n    Projected saving: $${r.estimatedMonthlySavingsUsd.toFixed(2)}/mo (${r.sampleCount.toLocaleString()} samples)`,
    )
    .join('\n\n')

  const subject = `[Spanlens] ${recommendations.length} high-confidence cost saving${recommendations.length > 1 ? 's' : ''} for ${orgName}`

  const text = [
    `Spanlens detected ${recommendations.length} high-confidence cost-saving recommendation${recommendations.length > 1 ? 's' : ''} for ${orgName}.`,
    '',
    recList,
    '',
    `These recommendations meet the high-confidence threshold (≥$${HIGH_CONFIDENCE_MIN_SAVINGS}/mo projected savings with ≥${HIGH_CONFIDENCE_MIN_SAMPLES} data samples).`,
    '',
    `Review and apply in the Savings dashboard:`,
    dashboardUrl,
    '',
    `You will receive this notification only once per recommendation. Future high-confidence findings will trigger new alerts.`,
  ].join('\n')

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: fromAddress, to: [toEmail], subject, text }),
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { ok: false, error: `Resend ${res.status}: ${body.slice(0, 200)}` }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown' }
  }
}

/**
 * Main job: runs recommendations for every org, finds newly-high-confidence
 * swaps, sends email to the org owner, and records the notification.
 */
export async function sendHighConfidenceRecommendationAlerts(): Promise<RecommendNotifyResult[]> {
  const dashboardBase = process.env['WEB_URL'] ?? 'https://www.spanlens.io'
  const dashboardUrl = `${dashboardBase}/savings`

  const { data: orgs, error: orgsErr } = await supabaseAdmin
    .from('organizations')
    .select('id, name, owner_id')
    .returns<OrgRow[]>()

  if (orgsErr || !orgs) {
    console.error('[rec-notify] failed to list orgs:', orgsErr?.message)
    return []
  }

  const results: RecommendNotifyResult[] = []

  for (const org of orgs) {
    const result: RecommendNotifyResult = { orgId: org.id, sent: 0, skipped: 0, errors: [] }

    try {
      // 1. Run the recommendation engine for this org
      const recs = await recommendModelSwaps(org.id, {
        hours: ANALYSIS_HOURS,
        minSavingsUsd: HIGH_CONFIDENCE_MIN_SAVINGS,
      })

      const highConf = recs.filter(
        (r) =>
          r.estimatedMonthlySavingsUsd >= HIGH_CONFIDENCE_MIN_SAVINGS &&
          r.sampleCount >= HIGH_CONFIDENCE_MIN_SAMPLES,
      )

      if (highConf.length === 0) {
        results.push(result)
        continue
      }

      // 2. Find already-notified keys for this org
      const { data: existingNotifs } = await supabaseAdmin
        .from('recommendation_notifications')
        .select('recommendation_key')
        .eq('organization_id', org.id)

      const notifiedKeys = new Set(
        (existingNotifs ?? []).map(
          (n: { recommendation_key: string }) => n.recommendation_key,
        ),
      )

      const newRecs = highConf.filter(
        (r) =>
          !notifiedKeys.has(
            makeRecKey(
              r.currentProvider,
              r.currentModel,
              r.suggestedProvider,
              r.suggestedModel,
            ),
          ),
      )

      if (newRecs.length === 0) {
        result.skipped = highConf.length
        results.push(result)
        continue
      }

      // 3. Resolve owner email via auth admin API
      const { data: userData, error: userErr } =
        await supabaseAdmin.auth.admin.getUserById(org.owner_id)

      if (userErr || !userData?.user?.email) {
        result.errors.push(
          `could not resolve owner email: ${userErr?.message ?? 'no email'}`,
        )
        results.push(result)
        continue
      }

      // 4. Send notification email
      const delivery = await sendRecommendationAlert(
        userData.user.email,
        org.name,
        newRecs,
        dashboardUrl,
      )

      if (!delivery.ok) {
        result.errors.push(`email failed: ${delivery.error ?? 'unknown'}`)
        results.push(result)
        continue
      }

      // 5. Record each notified key — UNIQUE constraint prevents double-insert
      const rows = newRecs.map((r) => ({
        organization_id: org.id,
        recommendation_key: makeRecKey(
          r.currentProvider,
          r.currentModel,
          r.suggestedProvider,
          r.suggestedModel,
        ),
        confidence_level: 'high' as const,
        savings_usd: r.estimatedMonthlySavingsUsd,
      }))

      const { error: insertErr } = await supabaseAdmin
        .from('recommendation_notifications')
        .upsert(rows, {
          onConflict: 'organization_id,recommendation_key',
          ignoreDuplicates: true,
        })

      if (insertErr) {
        // Non-fatal: email was sent, just log the tracking failure
        console.error('[rec-notify] failed to record notifications:', insertErr.message)
      }

      result.sent = newRecs.length
    } catch (err) {
      result.errors.push(err instanceof Error ? err.message : 'unknown')
    }

    results.push(result)
  }

  return results
}
