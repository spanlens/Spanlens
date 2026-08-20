import { supabaseAdmin } from './db.js'

/**
 * Debounce for the cron jobs that aggregate the `requests` log.
 *
 * Three independent schedulers fire the same `/cron/*` endpoints: the
 * `crons` array in `apps/server/vercel.json`, the safety-net workflow in
 * `.github/workflows/cron-server.yml`, and a handful of Better Stack
 * monitors. That redundancy is deliberate, because Vercel silently drops
 * scheduled runs and GitHub Actions throttles short cadences (CLAUDE.md
 * gotcha #32), so no single scheduler is trustworthy on its own.
 *
 * For jobs whose only cost is a Postgres write the duplication is free.
 * For the four jobs that aggregate `requests` it is not: every firing
 * repeats a full scan over the log window, so the second and third run of
 * the hour spend real database time recomputing the first run's answer.
 *
 * This guard moves the *effective* cadence into the handler, so how often
 * the work really happens no longer depends on retiming a monitor in
 * someone's dashboard. Whichever scheduler wins the race does the work;
 * the rest get a cheap no-op.
 *
 * Deliberately fail-open: if the `cron_job_runs` lookup errors we run the
 * job. Skipping real work because Postgres hiccuped is a worse failure
 * than one redundant scan.
 */

/**
 * Minutes a `requests`-aggregating cron must wait before it is allowed to run
 * again, regardless of how many schedulers fire it. Slightly under an hour
 * so an hourly schedule that drifts a few minutes late still runs instead
 * of being skipped into the next hour.
 */
export const SCAN_CRON_MIN_INTERVAL_MINUTES = 55

/**
 * Whether `jobName` already completed successfully within the last
 * `minutes`. Callers use this to skip redundant runs.
 */
export async function ranSuccessfullyWithin(jobName: string, minutes: number): Promise<boolean> {
  const cutoff = new Date(Date.now() - minutes * 60 * 1000).toISOString()

  try {
    const { data, error } = await supabaseAdmin
      .from('cron_job_runs')
      .select('ran_at')
      .eq('job_name', jobName)
      .eq('status', 'ok')
      .gte('ran_at', cutoff)
      .limit(1)

    if (error) {
      console.error(`[cron-cadence] lookup failed for ${jobName}: ${error.message}`)
      return false
    }
    return (data ?? []).length > 0
  } catch (err) {
    console.error(`[cron-cadence] lookup failed for ${jobName}:`, err)
    return false
  }
}

/**
 * When `jobName` last completed successfully, or `null` if it never has (or
 * the lookup failed). Callers use it as the lower bound for "has anything
 * changed since we last did this work".
 *
 * Same fail-open contract as `ranSuccessfullyWithin`: `null` should lead the
 * caller to do the work, not to skip it.
 */
export async function lastSuccessfulRunAt(jobName: string): Promise<Date | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from('cron_job_runs')
      .select('ran_at')
      .eq('job_name', jobName)
      .eq('status', 'ok')
      .order('ran_at', { ascending: false })
      .limit(1)

    if (error) {
      console.error(`[cron-cadence] last-run lookup failed for ${jobName}: ${error.message}`)
      return null
    }
    const raw = (data ?? [])[0] as { ran_at?: string } | undefined
    if (!raw?.ran_at) return null
    const ms = Date.parse(raw.ran_at)
    return Number.isNaN(ms) ? null : new Date(ms)
  } catch (err) {
    console.error(`[cron-cadence] last-run lookup failed for ${jobName}:`, err)
    return null
  }
}

export interface CadenceSkip {
  success: true
  skipped: 'cadence'
  job: string
  min_interval_minutes: number
}

/**
 * Body returned to the scheduler when a run is debounced. A 200 keeps the
 * calling workflow / monitor green — a skip is the guard working, not a
 * failure. No `cron_job_runs` row is written: the row means "this job did
 * its work", and self-monitor's health view would be misleading if
 * no-ops padded it.
 */
export function cadenceSkipResponse(jobName: string, minutes: number): CadenceSkip {
  return { success: true, skipped: 'cadence', job: jobName, min_interval_minutes: minutes }
}
