import { supabaseAdmin } from './db.js'

/**
 * Record one cron job execution. Fire-and-forget — never throws.
 * Caller measures elapsed time and passes it in.
 */
export async function logCronRun(
  jobName: string,
  status: 'ok' | 'error',
  durationMs: number,
  errorMessage?: string,
): Promise<void> {
  await supabaseAdmin.from('cron_job_runs').insert({
    job_name: jobName,
    status,
    duration_ms: Math.round(durationMs),
    error_message: errorMessage ?? null,
  })
}

/**
 * Wrap an async function so the result is logged to cron_job_runs.
 * Returns the wrapped function's return value; never re-throws.
 */
export async function withCronLog<T>(
  jobName: string,
  fn: () => Promise<T>,
): Promise<T | null> {
  const start = Date.now()
  try {
    const result = await fn()
    logCronRun(jobName, 'ok', Date.now() - start).catch(console.error)
    return result
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logCronRun(jobName, 'error', Date.now() - start, msg).catch(console.error)
    return null
  }
}
