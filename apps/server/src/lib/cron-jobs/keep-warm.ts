/**
 * /cron/keep-warm — warm Supabase + ClickHouse pools so the next user
 * request doesn't pay cold-start latency. Runs every 5 min.
 *
 * Extracted from api/cron.ts. Both warmups run via Promise.allSettled —
 * a slow dependency cannot block the other. Never throws (this fires
 * every 5 min and a transient warmup failure is not worth alerting on).
 *
 * No logCronRun call: every-5-min cadence would flood cron_job_runs.
 */

import { warmClickhouse } from '../clickhouse.js'
import { supabaseAdmin } from '../db.js'

export interface KeepWarmResult {
  ok: boolean
  ts: string
  durationMs: number
  warmed: { supabase: boolean; clickhouse: boolean }
}

export async function runKeepWarmJob(): Promise<KeepWarmResult> {
  const started = Date.now()
  const results = await Promise.allSettled([
    supabaseAdmin.from('organizations').select('id', { count: 'exact', head: true }).limit(1),
    // Real `SELECT 1`, not HTTP /ping: ClickHouse Cloud only resets its
    // idle-suspend timer on query activity, so a ping-only warmup let the
    // Development tier suspend anyway. Generous timeout rides out a cold
    // wake (minutes) — this runs as a cron, nobody is waiting on it.
    warmClickhouse(30_000),
  ])

  const supabaseOk = results[0].status === 'fulfilled'
  // warmClickhouse swallows its own errors and resolves to false — read
  // the value, not the settled status.
  const clickhouseOk =
    results[1].status === 'fulfilled' && results[1].value === true

  return {
    ok: supabaseOk && clickhouseOk,
    ts: new Date().toISOString(),
    durationMs: Date.now() - started,
    warmed: { supabase: supabaseOk, clickhouse: clickhouseOk },
  }
}
