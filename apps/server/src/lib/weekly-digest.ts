/**
 * Weekly usage digest email.
 *
 * Every Monday 09:00 UTC (/cron/weekly-digest) each org's admins get a
 * summary of the last 7 full UTC days: request volume, spend, week-over-week
 * cost change, error count, top models by cost, anomalies persisted by the
 * daily snapshot job, and the single best model-swap recommendation.
 *
 * Orgs with zero requests in the window are skipped entirely — no
 * "you did nothing this week" emails. Recipients honour the per-user
 * `weekly_digest_emails` preference via lib/digest-recipients.ts (NOT the
 * security_alert_emails switch used by getAdminEmails).
 *
 * Dedup: one digest per ISO week. Both schedulers (Vercel cron + the
 * GitHub Actions backup in cron-server.yml) hit the same endpoint, so the
 * job first checks cron_job_runs for a successful 'weekly-digest' run since
 * Monday 00:00 UTC and no-ops if one exists. Best-effort: two runs starting
 * in the same second could both pass the check, which is acceptable for a
 * summary email (same trade-off as stale-key-digest.ts documents).
 *
 * Structure mirrors data-silence.ts / stale-key-digest.ts: global ClickHouse
 * aggregation is allowed here (lib file) because organization_id is part of
 * the GROUP BY and every downstream write/email is keyed per org.
 */

import { supabaseAdmin } from './db.js'
import { unscopedClickhouse, toClickhouseTimestamp } from './clickhouse.js'
import { sendEmail, renderWeeklyDigestEmail } from './resend.js'
import { getWeeklyDigestRecipients } from './digest-recipients.js'
import { recommendModelSwaps, type ModelRecommendation } from './model-recommend.js'

/** Digest window length: the last 7 full UTC days. */
export const DIGEST_WINDOW_DAYS = 7
/** How many models the "top models by cost" table shows. */
export const DIGEST_TOP_MODELS_LIMIT = 3

export interface DigestWindow {
  /** Start of the digest week (00:00 UTC, inclusive). */
  weekStart: Date
  /** End of the digest week = start of today UTC (exclusive). */
  weekEnd: Date
  /** Start of the comparison week immediately before (inclusive). */
  priorStart: Date
}

/**
 * The last 7 FULL UTC days ending at today's 00:00 UTC, plus the 7 days
 * before that for the week-over-week comparison. Pure — no I/O.
 */
export function computeDigestWindow(now: Date = new Date()): DigestWindow {
  const weekEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const weekStart = new Date(weekEnd.getTime() - DIGEST_WINDOW_DAYS * 86_400_000)
  const priorStart = new Date(weekEnd.getTime() - 2 * DIGEST_WINDOW_DAYS * 86_400_000)
  return { weekStart, weekEnd, priorStart }
}

/** Monday 00:00 UTC of the ISO week containing `now`. Pure — no I/O. */
export function isoWeekStartUtc(now: Date = new Date()): Date {
  const daysSinceMonday = (now.getUTCDay() + 6) % 7
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceMonday),
  )
}

/** Human label for the digest window, e.g. "Jun 29 to Jul 5". */
export function formatPeriodLabel(window: DigestWindow): string {
  const fmt = (d: Date): string =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  const lastDay = new Date(window.weekEnd.getTime() - 86_400_000)
  return `${fmt(window.weekStart)} to ${fmt(lastDay)}`
}

export interface OrgWeekStats {
  organization_id: string
  request_count: number
  total_cost_usd: number
  error_count: number
  prior_request_count: number
  prior_cost_usd: number
}

export interface TopModel {
  provider: string
  model: string
  cost_usd: number
  request_count: number
}

/**
 * Week-over-week cost change in percent. Pure — no I/O.
 * Returns null when the prior week has no comparable data (zero requests
 * or zero recorded cost), so the email can say "no prior week" instead of
 * a misleading +Infinity%.
 */
export function computeCostChangePct(
  currentCostUsd: number,
  priorCostUsd: number,
  priorRequestCount: number,
): number | null {
  if (priorRequestCount === 0) return null
  if (priorCostUsd <= 0) return null
  return ((currentCostUsd - priorCostUsd) / priorCostUsd) * 100
}

/** Highest projected-savings recommendation, or null. Pure — no I/O. */
export function pickTopRecommendation(
  recs: ModelRecommendation[],
): ModelRecommendation | null {
  if (recs.length === 0) return null
  return recs.reduce((best, r) =>
    r.estimatedMonthlySavingsUsd > best.estimatedMonthlySavingsUsd ? r : best,
  )
}

/**
 * Sort each org's model buckets by cost (desc) and keep the top N.
 * Pure — no I/O.
 */
export function topModelsByOrg(
  rows: Array<TopModel & { organization_id: string }>,
  limit: number = DIGEST_TOP_MODELS_LIMIT,
): Map<string, TopModel[]> {
  const byOrg = new Map<string, TopModel[]>()
  for (const row of rows) {
    const list = byOrg.get(row.organization_id) ?? []
    byOrg.set(row.organization_id, [
      ...list,
      {
        provider: row.provider,
        model: row.model,
        cost_usd: row.cost_usd,
        request_count: row.request_count,
      },
    ])
  }
  const trimmed = new Map<string, TopModel[]>()
  for (const [orgId, list] of byOrg) {
    trimmed.set(
      orgId,
      [...list].sort((a, b) => b.cost_usd - a.cost_usd).slice(0, limit),
    )
  }
  return trimmed
}

/**
 * One global ClickHouse round-trip covering both weeks: per-org request
 * count, cost, and error count for the digest week plus the prior week's
 * count and cost. organization_id is in the GROUP BY so every row is
 * org-scoped.
 */
async function fetchOrgWeekStats(window: DigestWindow): Promise<OrgWeekStats[]> {
  const result = await unscopedClickhouse().query({
    query:
      'SELECT organization_id, ' +
      '  countIf(created_at >= parseDateTime64BestEffort({weekStart:String})) AS request_count, ' +
      '  sumIf(cost_usd, created_at >= parseDateTime64BestEffort({weekStart:String})) AS total_cost_usd, ' +
      '  countIf(created_at >= parseDateTime64BestEffort({weekStart:String}) AND status_code >= 400) AS error_count, ' +
      '  countIf(created_at < parseDateTime64BestEffort({weekStart:String})) AS prior_request_count, ' +
      '  sumIf(cost_usd, created_at < parseDateTime64BestEffort({weekStart:String})) AS prior_cost_usd ' +
      'FROM requests ' +
      'WHERE created_at >= parseDateTime64BestEffort({priorStart:String}) ' +
      '  AND created_at < parseDateTime64BestEffort({weekEnd:String}) ' +
      'GROUP BY organization_id',
    query_params: {
      weekStart: toClickhouseTimestamp(window.weekStart),
      weekEnd: toClickhouseTimestamp(window.weekEnd),
      priorStart: toClickhouseTimestamp(window.priorStart),
    },
    format: 'JSONEachRow',
  })

  // JSONEachRow returns UInt64 counts and Decimal sums as strings — coerce
  // every numeric at the boundary (gotcha #19).
  const raw = (await result.json()) as Array<{
    organization_id: string
    request_count: string | number
    total_cost_usd: string | number | null
    error_count: string | number
    prior_request_count: string | number
    prior_cost_usd: string | number | null
  }>

  return raw.map((r) => ({
    organization_id: r.organization_id,
    request_count: Number(r.request_count ?? 0),
    total_cost_usd: Number(r.total_cost_usd ?? 0),
    error_count: Number(r.error_count ?? 0),
    prior_request_count: Number(r.prior_request_count ?? 0),
    prior_cost_usd: Number(r.prior_cost_usd ?? 0),
  }))
}

/**
 * Global per-(org, provider, model) cost buckets for the digest week.
 * Grouped/trimmed to the top 3 per org in JS via topModelsByOrg.
 */
async function fetchTopModels(window: DigestWindow): Promise<Map<string, TopModel[]>> {
  const result = await unscopedClickhouse().query({
    query:
      'SELECT organization_id, provider, model, ' +
      '  sum(cost_usd) AS cost_usd, ' +
      '  count() AS request_count ' +
      'FROM requests ' +
      'WHERE created_at >= parseDateTime64BestEffort({weekStart:String}) ' +
      '  AND created_at < parseDateTime64BestEffort({weekEnd:String}) ' +
      "  AND model != '' " +
      'GROUP BY organization_id, provider, model',
    query_params: {
      weekStart: toClickhouseTimestamp(window.weekStart),
      weekEnd: toClickhouseTimestamp(window.weekEnd),
    },
    format: 'JSONEachRow',
  })

  const raw = (await result.json()) as Array<{
    organization_id: string
    provider: string
    model: string
    cost_usd: string | number | null
    request_count: string | number
  }>

  return topModelsByOrg(
    raw.map((r) => ({
      organization_id: r.organization_id,
      provider: r.provider,
      model: r.model,
      cost_usd: Number(r.cost_usd ?? 0),
      request_count: Number(r.request_count ?? 0),
    })),
  )
}

/**
 * Anomalies persisted this week by the daily snapshot cron
 * (lib/anomaly-snapshot.ts → anomaly_events). One cheap indexed count per
 * emailed org — no detection is recomputed. Returns null when the lookup
 * fails so the email omits the line instead of showing a wrong zero.
 */
async function fetchAnomalyCount(
  orgId: string,
  window: DigestWindow,
): Promise<number | null> {
  const { count, error } = await supabaseAdmin
    .from('anomaly_events')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .gte('detected_on', window.weekStart.toISOString().slice(0, 10))
    .lt('detected_on', window.weekEnd.toISOString().slice(0, 10))

  if (error) return null
  return count ?? 0
}

/**
 * Best model-swap recommendation for the org, or null. recommendModelSwaps
 * is the same per-org engine the daily recommend-savings-alerts cron already
 * runs, so a weekly call is cheap. Failures degrade to null — the digest
 * still goes out without the recommendation block.
 */
async function fetchTopRecommendation(orgId: string): Promise<ModelRecommendation | null> {
  try {
    const recs = await recommendModelSwaps(orgId)
    return pickTopRecommendation(recs)
  } catch {
    return null
  }
}

async function fetchOrgNames(orgIds: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>()
  if (orgIds.length === 0) return names
  const { data } = await supabaseAdmin
    .from('organizations')
    .select('id, name')
    .in('id', orgIds)
  for (const row of (data ?? []) as Array<{ id: string; name: string | null }>) {
    if (row.name) names.set(row.id, row.name)
  }
  return names
}

/**
 * Atomically claim this ISO week's digest run via the weekly_digest_runs
 * primary key. Exactly one runner wins when Vercel cron and the GH Actions
 * backup fire together (gotcha #32); the loser sees 23505 and skips. The
 * claim happens BEFORE any email is sent, so the dedup window is closed for
 * the job's whole runtime, not just after completion.
 *
 * Returns 'claimed' | 'already-claimed' | 'error'. Errors other than 23505
 * are surfaced so the caller can decide (we fail open: a rare transient DB
 * error risks a duplicate summary, which beats silently sending nothing).
 */
async function claimWeeklyDigestRun(now: Date): Promise<'claimed' | 'already-claimed' | 'error'> {
  const weekStart = isoWeekStartUtc(now).toISOString().slice(0, 10)
  const { error } = await supabaseAdmin
    .from('weekly_digest_runs')
    .insert({ week_start: weekStart })

  if (!error) return 'claimed'
  if (error.code === '23505') return 'already-claimed'
  console.error('weekly-digest claim failed', error.message)
  return 'error'
}

export interface WeeklyDigestRunResult {
  /** True when a successful run this ISO week already exists — nothing sent. */
  skipped: boolean
  /** True when the aggregation phase ran (per-org errors may still exist). */
  completed: boolean
  /** Orgs with at least one request in the digest window. */
  orgs_scanned: number
  /** Orgs skipped because every admin opted out (or the org has no admins). */
  orgs_no_recipients: number
  /** Orgs where Resend accepted at least one recipient. Stays 0 without RESEND_API_KEY. */
  digests_sent: number
  errors: string[]
}

export async function runWeeklyDigestJob(now: Date = new Date()): Promise<WeeklyDigestRunResult> {
  const result: WeeklyDigestRunResult = {
    skipped: false,
    completed: false,
    orgs_scanned: 0,
    orgs_no_recipients: 0,
    digests_sent: 0,
    errors: [],
  }

  // Dedup guard: one digest per ISO week even when both schedulers fire.
  // The claim is atomic (PK insert) and taken before any email goes out.
  // A transient claim error is non-fatal — worst case is a duplicate
  // summary email, which beats silently sending nothing.
  const claim = await claimWeeklyDigestRun(now)
  if (claim === 'already-claimed') {
    result.skipped = true
    result.completed = true
    return result
  }
  if (claim === 'error') {
    result.errors.push('weekly_digest_runs claim failed, proceeding without dedup')
  }

  const window = computeDigestWindow(now)

  let stats: OrgWeekStats[]
  let topModels: Map<string, TopModel[]>
  try {
    ;[stats, topModels] = await Promise.all([
      fetchOrgWeekStats(window),
      fetchTopModels(window),
    ])
  } catch (err) {
    result.errors.push(err instanceof Error ? err.message : 'unknown')
    return result
  }

  // Orgs with zero requests this week never get an email. Rows can exist
  // with request_count = 0 when only the PRIOR week had traffic.
  const activeOrgs = stats.filter((s) => s.request_count > 0)
  result.orgs_scanned = activeOrgs.length
  if (activeOrgs.length === 0) {
    result.completed = true
    return result
  }

  const orgNames = await fetchOrgNames(activeOrgs.map((s) => s.organization_id))
  const dashboardBase = process.env['WEB_URL'] ?? 'https://www.spanlens.io'
  const periodLabel = formatPeriodLabel(window)

  for (const org of activeOrgs) {
    try {
      const recipients = await getWeeklyDigestRecipients(org.organization_id)
      if (recipients.length === 0) {
        result.orgs_no_recipients++
        continue
      }

      const [anomalyCount, recommendation] = await Promise.all([
        fetchAnomalyCount(org.organization_id, window),
        fetchTopRecommendation(org.organization_id),
      ])

      const { subject, html } = renderWeeklyDigestEmail({
        orgName: orgNames.get(org.organization_id) ?? 'your workspace',
        periodLabel,
        requestCount: org.request_count,
        totalCostUsd: org.total_cost_usd,
        costChangePct: computeCostChangePct(
          org.total_cost_usd,
          org.prior_cost_usd,
          org.prior_request_count,
        ),
        errorCount: org.error_count,
        errorRatePct: (org.error_count / org.request_count) * 100,
        topModels: (topModels.get(org.organization_id) ?? []).map((m) => ({
          provider: m.provider,
          model: m.model,
          costUsd: m.cost_usd,
          requestCount: m.request_count,
        })),
        anomalyCount,
        recommendation: recommendation
          ? {
              currentModel: recommendation.currentModel,
              suggestedModel: recommendation.suggestedModel,
              estimatedMonthlySavingsUsd: recommendation.estimatedMonthlySavingsUsd,
            }
          : null,
        dashboardUrl: `${dashboardBase}/dashboard`,
      })

      let sentToAtLeastOne = false
      for (const to of recipients) {
        const r = await sendEmail({ to, subject, html })
        if (r.sent) sentToAtLeastOne = true
      }

      if (sentToAtLeastOne) {
        result.digests_sent++
        await supabaseAdmin.from('audit_logs').insert({
          organization_id: org.organization_id,
          action: 'retention.weekly_digest_sent',
          resource_type: 'organization',
          resource_id: org.organization_id,
          metadata: {
            requests: org.request_count,
            cost_usd: org.total_cost_usd,
            recipients: recipients.length,
          },
        })
      }
    } catch (err) {
      result.errors.push(
        `org ${org.organization_id}: ${err instanceof Error ? err.message : 'unknown'}`,
      )
    }
  }

  result.completed = true
  return result
}
