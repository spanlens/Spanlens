/**
 * Better Stack (or any pinger) heartbeat — "this cron actually fired and
 * succeeded" signal, sent from inside the job itself.
 *
 * Why: HTTP uptime checks only prove the endpoint answers when poked.
 * The failure mode that actually bit us (CLAUDE.md gotcha #32, cron-server.yml
 * header: Vercel scheduler silently dropping ~96% of the every-5-minute
 * runs) is the scheduler never firing — invisible to uptime checks.
 * A heartbeat monitor alerts when the signal *stops arriving*, which is
 * exactly that case.
 *
 * Opt-in per job via env: `HEARTBEAT_<JOB_NAME>` with `-` → `_`, uppercased.
 *   replay-fallback           → HEARTBEAT_REPLAY_FALLBACK
 *   self-monitor              → HEARTBEAT_SELF_MONITOR
 *   execute-pending-deletions → HEARTBEAT_EXECUTE_PENDING_DELETIONS
 *   evaluate-alerts           → HEARTBEAT_EVALUATE_ALERTS
 * Unset env → no-op, so jobs without a monitor cost nothing.
 *
 * Never throws. Callers MUST await (it is called from `logCronRun`, whose
 * contract already guarantees the await — naked fire-and-forget promises
 * are dropped by Vercel the moment the response returns, gotcha #8).
 * 5s timeout so a pinger outage can never meaningfully delay a cron.
 */
export async function pingHeartbeat(jobName: string): Promise<void> {
  const envKey = `HEARTBEAT_${jobName.toUpperCase().replace(/-/g, '_')}`
  const url = process.env[envKey]
  if (!url) return
  try {
    await fetch(url, { method: 'GET', signal: AbortSignal.timeout(5_000) })
  } catch (err) {
    // A lost heartbeat ping at worst causes one false "missing" alert —
    // never let it affect the cron run itself.
    console.error(`[cron-heartbeat] ping failed for ${jobName}:`, err)
  }
}
