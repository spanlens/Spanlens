'use client'
import { CronJobsPanel } from '../cron-jobs-panel'
import { TabHeader } from '../_shared/ui'

// ─── SYSTEM tab ───────────────────────────────────────────────────────────────

export function SystemTab() {
  return (
    <div className="max-w-[980px]">
      <TabHeader
        title="System"
        description="Cron job execution history. Runs are logged after each execution. Refreshes every 60s."
      />
      <div className="border border-border rounded-[8px] overflow-hidden">
        <CronJobsPanel />
      </div>
    </div>
  )
}
