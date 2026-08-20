'use client'
import { CronJobsPanel } from '../cron-jobs-panel'
import { TabHeader } from '../_shared/ui'

// ─── SYSTEM tab ───────────────────────────────────────────────────────────────

export function SystemTab() {
  return (
    <div>
      <TabHeader
        title="System"
        description="Cron job execution history. Runs are logged after each execution. Refreshes every 60s."
      />
      <div className="rounded-card border border-border bg-bg-elev shadow-card overflow-hidden">
        <CronJobsPanel />
      </div>
    </div>
  )
}
