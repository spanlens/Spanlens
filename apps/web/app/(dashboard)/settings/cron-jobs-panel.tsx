'use client'
import { useCronRuns, type CronJobSummary } from '@/lib/queries/use-system'

// Known cron schedules for display (mirrors apps/server/vercel.json + cron.ts)
const CRON_SCHEDULES: Record<string, string> = {
  'evaluate-alerts':           '*/15 * * * *',
  'snapshot-anomalies':        '0 1 * * *',
  'stale-key-reminders':       '0 9 * * 1',
  'leak-detect-keys':          '0 4 * * *',
  'recommend-savings-alerts':  '0 9 * * *',
  'aggregate-usage':           '0 * * * *',
  'report-usage-overage':      '0 0 * * *',
  'check-quota-warnings':      '0 * * * *',
  'prune-logs':                '0 3 * * *',
  'retry-webhooks':            '*/5 * * * *',
}

function relTime(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

function StatusDot({ status }: { status: 'ok' | 'error' }) {
  return (
    <span
      className={`inline-block h-1.5 w-1.5 rounded-full ${
        status === 'ok' ? 'bg-good' : 'bg-bad'
      }`}
    />
  )
}

function JobRow({ job }: { job: CronJobSummary }) {
  const schedule = CRON_SCHEDULES[job.jobName] ?? '—'

  return (
    <div className="flex items-center gap-3 px-[22px] py-[11px] border-b border-border last:border-0">
      <StatusDot status={job.lastStatus} />
      <span className="font-mono text-[12px] text-text flex-1 min-w-0 truncate">
        {job.jobName}
      </span>
      <span className="font-mono text-[11px] text-text-faint shrink-0 hidden sm:block w-36">
        {schedule}
      </span>
      <span
        className="font-mono text-[11px] text-text-muted shrink-0 w-24 text-right"
        title={new Date(job.lastRanAt).toLocaleString()}
      >
        {relTime(job.lastRanAt)}
      </span>
      <span className="font-mono text-[11px] text-text-faint shrink-0 w-16 text-right">
        {job.lastDurationMs != null ? `${job.lastDurationMs}ms` : '—'}
      </span>
      {job.lastStatus === 'error' && job.lastErrorMessage && (
        <span
          className="font-mono text-[10px] text-bad truncate max-w-[200px]"
          title={job.lastErrorMessage}
        >
          {job.lastErrorMessage}
        </span>
      )}
    </div>
  )
}

export function CronJobsPanel() {
  const { data: jobs, isLoading } = useCronRuns()

  if (isLoading) {
    return (
      <div className="space-y-2 p-6">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-8 bg-bg-elev rounded animate-pulse" />
        ))}
      </div>
    )
  }

  if (!jobs || jobs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-2 text-text-faint">
        <p className="font-mono text-[13px]">No cron runs recorded yet.</p>
        <p className="font-mono text-[11px]">Runs are logged after the first execution.</p>
      </div>
    )
  }

  const sorted = [...jobs].sort((a, b) => a.jobName.localeCompare(b.jobName))

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 px-[22px] py-[8px] border-b border-border bg-bg-elev">
        <span className="w-3 shrink-0" />
        <span className="font-mono text-[10px] uppercase tracking-[0.07em] text-text-faint flex-1">Job</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.07em] text-text-faint shrink-0 hidden sm:block w-36">Schedule</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.07em] text-text-faint shrink-0 w-24 text-right">Last run</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.07em] text-text-faint shrink-0 w-16 text-right">Duration</span>
      </div>
      {sorted.map((job) => (
        <JobRow key={job.jobName} job={job} />
      ))}
    </div>
  )
}
