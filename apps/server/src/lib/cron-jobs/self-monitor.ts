/**
 * /cron/self-monitor — production-side watchdog over cron_job_runs.
 *
 * Extracted from api/cron.ts. Replaces the "keep a Claude session open
 * for 24h" pattern with something that works while the operator is
 * asleep. Scans the last hour of cron_job_runs for failures and writes a
 * single internal_alerts row of kind `cron_failure` summarising what
 * broke. Dedup against unresolved rows so the operator sees one chip
 * (not one per cron tick) until they push a fix.
 */

import { supabaseAdmin } from '../db.js'

export interface SelfMonitorResult {
  ok: boolean
  failures: number
  jobs?: Array<{ job_name: string; count: number; last_error: string | null; last_ran_at: string }>
  deduped?: boolean
  existing_alert_id?: string
  error?: string
}

export async function runSelfMonitorJob(): Promise<SelfMonitorResult> {
  try {
    const { data: failures, error: failuresErr } = await supabaseAdmin
      .from('cron_job_runs')
      .select('job_name, status, error_message, ran_at')
      .eq('status', 'error')
      .gte('ran_at', new Date(Date.now() - 60 * 60 * 1000).toISOString())
      .order('ran_at', { ascending: false })

    if (failuresErr) {
      return { ok: false, failures: 0, error: `cron_job_runs query failed: ${failuresErr.message}` }
    }

    const failureRows = failures ?? []
    if (failureRows.length === 0) return { ok: true, failures: 0 }

    const byJob = new Map<string, { count: number; lastError: string | null; lastRanAt: string }>()
    for (const row of failureRows) {
      const existing = byJob.get(row.job_name)
      if (existing) {
        existing.count += 1
      } else {
        byJob.set(row.job_name, {
          count: 1,
          lastError: row.error_message ?? null,
          lastRanAt: row.ran_at,
        })
      }
    }
    const jobs = Array.from(byJob.entries()).map(([job_name, summary]) => ({
      job_name,
      count: summary.count,
      last_error: summary.lastError,
      last_ran_at: summary.lastRanAt,
    }))
    const totalFailures = failureRows.length

    const { data: existing } = await supabaseAdmin
      .from('internal_alerts')
      .select('id')
      .eq('kind', 'cron_failure')
      .is('resolved_at', null)
      .limit(1)
      .maybeSingle()

    if (existing) {
      return { ok: true, failures: totalFailures, deduped: true, existing_alert_id: existing.id }
    }

    const { error: insertError } = await supabaseAdmin.from('internal_alerts').insert({
      kind: 'cron_failure',
      severity: 'error',
      message: `${jobs.length} cron job(s) failed in the last 1h (${totalFailures} run${totalFailures === 1 ? '' : 's'})`,
      details: { jobs, window_minutes: 60 },
    })

    if (insertError) {
      return { ok: false, failures: totalFailures, error: `internal_alerts insert failed: ${insertError.message}` }
    }

    return { ok: true, failures: totalFailures, jobs }
  } catch (err) {
    return { ok: false, failures: 0, error: err instanceof Error ? err.message : String(err) }
  }
}
