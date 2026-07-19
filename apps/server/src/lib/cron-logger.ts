import { supabaseAdmin } from './db.js'
import { pingHeartbeat } from './cron-heartbeat.js'

/**
 * Record one cron job execution. Never throws — a failed log write must not
 * fail the cron run itself, so callers can safely `await` this directly.
 *
 * Callers MUST `await` the returned promise (or route it through
 * `fireAndForget(c, ...)` from lib/wait-until.ts). A naked fire-and-forget
 * call (`logCronRun(...).catch(...)`) is dropped by Vercel the moment the
 * response returns (CLAUDE.md gotcha #8), which silently loses the
 * `cron_job_runs` row and makes the cron-health monitoring (gotcha #32)
 * misread "cron never fired". Cron endpoints are not latency-sensitive,
 * so awaiting the single INSERT is the standard pattern.
 */
export async function logCronRun(
  jobName: string,
  status: 'ok' | 'error',
  durationMs: number,
  errorMessage?: string,
): Promise<void> {
  try {
    const { error } = await supabaseAdmin.from('cron_job_runs').insert({
      job_name: jobName,
      status,
      duration_ms: Math.round(durationMs),
      error_message: errorMessage ?? null,
    })
    if (error) {
      console.error(`[cron-logger] failed to record run for ${jobName}: ${error.message}`)
    }
  } catch (err) {
    console.error(`[cron-logger] failed to record run for ${jobName}:`, err)
  }
  // External heartbeat on success — fires even if the log INSERT failed
  // (the job itself succeeded; the heartbeat reports job health, not DB
  // health). Single choke point: every cron routes through logCronRun,
  // so no per-handler wiring is needed. No-op unless HEARTBEAT_<JOB> is set.
  if (status === 'ok') {
    await pingHeartbeat(jobName)
  }
}

/**
 * Wrap an async function so the result is logged to cron_job_runs.
 * Returns the wrapped function's return value; never re-throws.
 * The log write is awaited so it is drained before the caller's
 * response returns (gotcha #8) — `logCronRun` never throws, so this
 * cannot change the wrapped function's outcome.
 */
export async function withCronLog<T>(
  jobName: string,
  fn: () => Promise<T>,
): Promise<T | null> {
  const start = Date.now()
  try {
    const result = await fn()
    await logCronRun(jobName, 'ok', Date.now() - start)
    return result
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await logCronRun(jobName, 'error', Date.now() - start, msg)
    return null
  }
}
