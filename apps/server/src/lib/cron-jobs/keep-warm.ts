/**
 * /cron/keep-warm: one small query against Supabase every 5 minutes so the
 * next user request doesn't pay cold-start latency.
 *
 * The query is a head-only count against `organizations` through the Supabase
 * REST client, which is the path auth, key lookup and billing all take. The
 * pooled connection in lib/postgres.ts (what `requests` reads use) is per
 * instance and is not shared with this cron, so it is not what gets warmed.
 *
 * Supabase bills storage and egress rather than wall-clock uptime, so a query
 * every 5 minutes has no cost consequence. That is a property of this backend,
 * not of warmup crons: pointing one at a service billed by uptime keeps that
 * service billed around the clock for as long as the cron runs.
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
