/**
 * /cron/keep-warm — warm the Supabase connection pool so the next user
 * request doesn't pay cold-start latency. Runs every 5 min.
 *
 * Used to also run a `SELECT 1` against ClickHouse (see git history and
 * `lib/clickhouse.ts`'s `pingClickhouse` docs for why that's gone). That
 * query is exactly what ClickHouse Cloud counts as "activity" when
 * deciding whether to reset its idle-suspend timer, so a warmup cron
 * firing every 5 minutes, 24/7, kept the Development tier billed as
 * continuously running — measured at $232/mo for a service handling
 * roughly 250 requests/month (2026-08-11). Supabase has no equivalent
 * idle-suspend/compute-hour billing model, so warming it here is still a
 * pure win with no cost downside.
 *
 * Never throws (this fires every 5 min and a transient warmup failure is
 * not worth alerting on). No logCronRun call: every-5-min cadence would
 * flood cron_job_runs.
 */

import { supabaseAdmin } from '../db.js'

export interface KeepWarmResult {
  ok: boolean
  ts: string
  durationMs: number
  warmed: { supabase: boolean }
}

export async function runKeepWarmJob(): Promise<KeepWarmResult> {
  const started = Date.now()
  const result = await supabaseAdmin
    .from('organizations')
    .select('id', { count: 'exact', head: true })
    .limit(1)

  return {
    ok: !result.error,
    ts: new Date().toISOString(),
    durationMs: Date.now() - started,
    warmed: { supabase: !result.error },
  }
}
