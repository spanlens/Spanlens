/**
 * "Data went silent" retention alert.
 *
 * An org that previously had steady traffic (>= DATA_SILENCE_MIN_PRIOR_REQUESTS
 * requests in the 7 days ending 24h ago) but sent ZERO requests in the last
 * 24h gets one email per silence episode telling admins their integration
 * probably broke. Runs every 6 hours via /cron/detect-data-silence.
 *
 * Dedup: one open episode per org, persisted in `data_silence_alerts`
 * (partial unique index on organization_id WHERE resolved_at IS NULL).
 * When traffic resumes the episode is resolved, so a future silence can
 * alert again. If email delivery failed on the run that opened the
 * episode (`email_sent = false`), the next run retries delivery without
 * opening a second episode.
 *
 * Structure mirrors stale-key-digest.ts: global ClickHouse aggregation is
 * allowed here (lib file) because organization_id is part of the GROUP BY
 * and every downstream write/emails are keyed per org.
 */

import { supabaseAdmin } from './db.js'
import { unscopedClickhouse, fromClickhouseTimestamp } from './clickhouse.js'
import { sendEmail, renderDataSilenceEmail } from './resend.js'
import { getAdminEmails } from './admin-emails.js'

/** Minimum prior-week volume before silence is considered meaningful. */
export const DATA_SILENCE_MIN_PRIOR_REQUESTS = 50
/** Silence window: zero requests in the last N hours triggers the alert. */
export const DATA_SILENCE_WINDOW_HOURS = 24
/** Baseline window: the 7 days ENDING at the start of the silence window. */
export const DATA_SILENCE_PRIOR_WINDOW_DAYS = 7

export interface OrgTrafficRow {
  organization_id: string
  /** Requests in the 7-day baseline window ending 24h ago. */
  prior_count: number
  /** Requests in the last 24h. */
  recent_count: number
  /** ISO-8601 UTC ('...Z') timestamp of the org's most recent request, or null. */
  last_request_at: string | null
}

export interface OpenEpisode {
  id: string
  organization_id: string
  email_sent: boolean
  last_request_at: string | null
  prior_week_requests: number
}

export interface SilencePlan {
  /** Orgs entering a new silence episode this run. */
  toOpen: OrgTrafficRow[]
  /** Open episodes whose org has traffic again. */
  toResolve: OpenEpisode[]
  /** Open episodes still silent whose alert email never went out. */
  toRetryEmail: OpenEpisode[]
}

/**
 * Pure decision logic — no I/O. Given per-org traffic counts and the set of
 * currently-open episodes, decide which episodes to open, resolve, and
 * which failed sends to retry.
 *
 * An org absent from `rows` had zero requests in the whole lookback window
 * (8 days), so it is still silent: its open episode stays open but it can
 * never OPEN a new episode (prior_count would be 0 < threshold).
 */
export function planSilenceActions(
  rows: OrgTrafficRow[],
  openEpisodes: OpenEpisode[],
): SilencePlan {
  const openByOrg = new Map(openEpisodes.map((e) => [e.organization_id, e]))
  const rowByOrg = new Map(rows.map((r) => [r.organization_id, r]))

  const toOpen = rows.filter(
    (r) =>
      r.recent_count === 0 &&
      r.prior_count >= DATA_SILENCE_MIN_PRIOR_REQUESTS &&
      !openByOrg.has(r.organization_id),
  )

  const toResolve = openEpisodes.filter((e) => {
    const row = rowByOrg.get(e.organization_id)
    return row !== undefined && row.recent_count > 0
  })

  const toRetryEmail = openEpisodes.filter((e) => {
    if (e.email_sent) return false
    const row = rowByOrg.get(e.organization_id)
    // Absent from rows = zero traffic for 8 days = still silent.
    return row === undefined || row.recent_count === 0
  })

  return { toOpen, toResolve, toRetryEmail }
}

/**
 * One global ClickHouse round-trip: per-org counts for the baseline window
 * and the silence window, plus the most recent request timestamp.
 * organization_id is in the GROUP BY so every row is org-scoped.
 */
async function fetchOrgTraffic(): Promise<OrgTrafficRow[]> {
  const totalDays = DATA_SILENCE_PRIOR_WINDOW_DAYS + 1 // baseline + silence window
  const result = await unscopedClickhouse().query({
    query:
      'SELECT organization_id, ' +
      `  countIf(created_at < now() - INTERVAL {windowHours:UInt32} HOUR) AS prior_count, ` +
      `  countIf(created_at >= now() - INTERVAL {windowHours:UInt32} HOUR) AS recent_count, ` +
      '  max(created_at) AS last_request_at ' +
      'FROM requests ' +
      `WHERE created_at >= now() - INTERVAL {totalDays:UInt32} DAY ` +
      'GROUP BY organization_id',
    query_params: {
      windowHours: DATA_SILENCE_WINDOW_HOURS,
      totalDays,
    },
    format: 'JSONEachRow',
  })

  // JSONEachRow returns UInt64 counts as strings and DateTime64 without the
  // trailing 'Z' — normalize both at the boundary (gotchas #18/#19).
  const raw = (await result.json()) as Array<{
    organization_id: string
    prior_count: string | number
    recent_count: string | number
    last_request_at: string | null
  }>

  return raw.map((r) => ({
    organization_id: r.organization_id,
    prior_count: Number(r.prior_count ?? 0),
    recent_count: Number(r.recent_count ?? 0),
    last_request_at: fromClickhouseTimestamp(r.last_request_at),
  }))
}

async function fetchOpenEpisodes(): Promise<OpenEpisode[]> {
  const { data, error } = await supabaseAdmin
    .from('data_silence_alerts')
    .select('id, organization_id, email_sent, last_request_at, prior_week_requests')
    .is('resolved_at', null)

  if (error) throw new Error(`failed to list open episodes: ${error.message}`)
  return (data ?? []) as OpenEpisode[]
}

export interface DataSilenceRunResult {
  orgs_scanned: number
  episodes_opened: number
  episodes_resolved: number
  /** Orgs where Resend accepted at least one recipient. Stays 0 without RESEND_API_KEY. */
  emails_sent: number
  errors: string[]
}

/**
 * Send the silence alert for one episode and flip email_sent on success.
 * Returns true if at least one recipient accepted delivery.
 */
async function deliverSilenceAlert(
  episodeId: string,
  orgId: string,
  lastRequestAt: string | null,
  priorWeekRequests: number,
  dashboardBase: string,
  errors: string[],
): Promise<boolean> {
  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('name')
    .eq('id', orgId)
    .single()
  const orgName = (org?.name as string | undefined) ?? 'your workspace'

  const recipients = await getAdminEmails(orgId)
  if (recipients.length === 0) {
    errors.push(`no admin recipients for org ${orgId}`)
    return false
  }

  const { subject, html } = renderDataSilenceEmail({
    orgName,
    lastRequestAt,
    priorWeekRequests,
    silenceWindowHours: DATA_SILENCE_WINDOW_HOURS,
    dashboardUrl: `${dashboardBase}/requests`,
    quickStartUrl: `${dashboardBase}/docs/quick-start`,
  })

  let sentToAtLeastOne = false
  for (const to of recipients) {
    const r = await sendEmail({ to, subject, html })
    if (r.sent) sentToAtLeastOne = true
  }

  if (sentToAtLeastOne) {
    await supabaseAdmin
      .from('data_silence_alerts')
      .update({ email_sent: true })
      .eq('id', episodeId)

    await supabaseAdmin.from('audit_logs').insert({
      organization_id: orgId,
      action: 'retention.data_silence_alert_sent',
      resource_type: 'organization',
      resource_id: orgId,
      metadata: { prior_week_requests: priorWeekRequests, recipients: recipients.length },
    })
  }

  return sentToAtLeastOne
}

export async function runDataSilenceJob(): Promise<DataSilenceRunResult> {
  const result: DataSilenceRunResult = {
    orgs_scanned: 0,
    episodes_opened: 0,
    episodes_resolved: 0,
    emails_sent: 0,
    errors: [],
  }

  let rows: OrgTrafficRow[]
  let openEpisodes: OpenEpisode[]
  try {
    ;[rows, openEpisodes] = await Promise.all([fetchOrgTraffic(), fetchOpenEpisodes()])
  } catch (err) {
    result.errors.push(err instanceof Error ? err.message : 'unknown')
    return result
  }

  result.orgs_scanned = rows.length
  const plan = planSilenceActions(rows, openEpisodes)
  const dashboardBase = process.env['WEB_URL'] ?? 'https://www.spanlens.io'

  // 1. Resolve episodes whose org has data again.
  if (plan.toResolve.length > 0) {
    const { error } = await supabaseAdmin
      .from('data_silence_alerts')
      .update({ resolved_at: new Date().toISOString() })
      .in('id', plan.toResolve.map((e) => e.id))
    if (error) {
      result.errors.push(`failed to resolve episodes: ${error.message}`)
    } else {
      result.episodes_resolved = plan.toResolve.length
    }
  }

  // 2. Open new episodes and send the alert email.
  for (const row of plan.toOpen) {
    try {
      const { data: inserted, error: insertErr } = await supabaseAdmin
        .from('data_silence_alerts')
        .insert({
          organization_id: row.organization_id,
          last_request_at: row.last_request_at,
          prior_week_requests: row.prior_count,
        })
        .select('id')
        .single()

      if (insertErr) {
        // 23505 = the partial unique index caught a concurrent run that
        // already opened this episode. Skip quietly — the other run emails.
        if (insertErr.code === '23505') continue
        result.errors.push(`org ${row.organization_id}: insert failed: ${insertErr.message}`)
        continue
      }

      result.episodes_opened++

      const sent = await deliverSilenceAlert(
        (inserted as { id: string }).id,
        row.organization_id,
        row.last_request_at,
        row.prior_count,
        dashboardBase,
        result.errors,
      )
      if (sent) result.emails_sent++
    } catch (err) {
      result.errors.push(
        `org ${row.organization_id}: ${err instanceof Error ? err.message : 'unknown'}`,
      )
    }
  }

  // 3. Retry delivery for still-silent episodes whose email never went out.
  for (const episode of plan.toRetryEmail) {
    try {
      const sent = await deliverSilenceAlert(
        episode.id,
        episode.organization_id,
        episode.last_request_at,
        episode.prior_week_requests,
        dashboardBase,
        result.errors,
      )
      if (sent) result.emails_sent++
    } catch (err) {
      result.errors.push(
        `org ${episode.organization_id}: retry failed: ${err instanceof Error ? err.message : 'unknown'}`,
      )
    }
  }

  return result
}
