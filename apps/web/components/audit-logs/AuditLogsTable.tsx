'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { formatAuditTimestamp, inferAuditSeverity } from '@/lib/audit-logs'
import type { AuditLogRow } from '@/lib/queries/use-audit-logs'
import { AuditLogDetailDrawer } from './AuditLogDetailDrawer'

interface Props {
  rows: AuditLogRow[]
  isLoading?: boolean
  emptyHint?: string
}

const SEVERITY_DOT = {
  high: 'bg-accent',
  med: 'bg-text-muted',
  low: 'bg-text-faint',
} as const

const SEVERITY_LABEL = {
  high: 'HIGH',
  med: 'MED',
  low: 'LOW',
} as const

/**
 * Tabular layout shared between the settings preview and the dedicated
 * audit viewer. Clicking a row opens AuditLogDetailDrawer for the full
 * JSON payload (metadata, ip_address, user_id).
 */
export function AuditLogsTable({ rows, isLoading, emptyHint }: Props) {
  const [selected, setSelected] = useState<AuditLogRow | null>(null)

  if (isLoading) {
    return (
      <div className="px-6 py-12 text-center font-mono text-[12.5px] text-text-faint">
        Loading audit log…
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="px-6 py-12 text-center font-mono text-[12.5px] text-text-faint">
        {emptyHint ?? 'No audit events match the current filters.'}
      </div>
    )
  }

  return (
    <>
      <div className="overflow-x-auto">
        <div className="divide-y divide-border min-w-[640px]">
          <div className="grid grid-cols-[140px_60px_220px_1fr_120px] gap-4 px-6 py-3 font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">
            <span>Time</span>
            <span>Sev</span>
            <span>Action</span>
            <span>Resource</span>
            <span className="text-right">Actor</span>
          </div>
          {rows.map((row) => {
            const sev = inferAuditSeverity(row.action)
            return (
              <button
                key={row.id}
                type="button"
                onClick={() => setSelected(row)}
                className="w-full grid grid-cols-[140px_60px_220px_1fr_120px] gap-4 px-6 py-3 items-center text-left hover:bg-bg-muted/40 transition-colors"
              >
                <span className="font-mono text-[11.5px] text-text-muted">
                  {formatAuditTimestamp(row.created_at)}
                </span>
                <span className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.04em] text-text-faint">
                  <span className={cn('h-1.5 w-1.5 rounded-full', SEVERITY_DOT[sev])} />
                  {SEVERITY_LABEL[sev]}
                </span>
                <span
                  className={cn(
                    'font-mono text-[11.5px] font-medium truncate',
                    sev === 'high' ? 'text-accent' : 'text-text',
                  )}
                >
                  {row.action}
                </span>
                <span className="font-mono text-[11.5px] text-text-muted truncate">
                  {row.resource_type}
                  {row.resource_id ? ` · ${row.resource_id.slice(0, 12)}…` : ''}
                </span>
                <span className="font-mono text-[10.5px] text-text-faint text-right truncate">
                  {row.user_id ? `${row.user_id.slice(0, 8)}…` : 'system'}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <AuditLogDetailDrawer
        row={selected}
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null)
        }}
      />
    </>
  )
}
