'use client'
import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { Section } from '@/components/ui/primitives'
import {
  useAuditLogActions,
  useAuditLogsPage,
  type UseAuditLogsParams,
} from '@/lib/queries/use-audit-logs'
import { inferAuditSeverity } from '@/lib/audit-logs'
import { AuditLogsTable } from '@/components/audit-logs/AuditLogsTable'
import { useIsAdmin, useCurrentRoleLoading } from '@/lib/queries/use-current-role'
import { TabHeader } from '../_shared/ui'

// ─── AUDIT LOG tab ────────────────────────────────────────────────────────────

const PAGE_SIZE_AUDIT = 50
type AuditTimeWindow = '7d' | '30d' | '90d' | 'all'

const AUDIT_TIME_WINDOWS: { value: AuditTimeWindow; label: string; days: number | null }[] = [
  { value: '7d',  label: 'Last 7 days',  days: 7 },
  { value: '30d', label: 'Last 30 days', days: 30 },
  { value: '90d', label: 'Last 90 days', days: 90 },
  { value: 'all', label: 'All time',     days: null },
]

function auditWindowToFrom(window: AuditTimeWindow): string | undefined {
  const entry = AUDIT_TIME_WINDOWS.find((w) => w.value === window)
  if (!entry || entry.days === null) return undefined
  return new Date(Date.now() - entry.days * 24 * 60 * 60 * 1000).toISOString()
}

/**
 * AuditLogTab — full audit log viewer.
 *
 * Renders the same content the dedicated /settings/audit-logs route used to
 * before we collapsed it back here. Filters by time window + action, paginates,
 * and opens a Drawer with the metadata JSON when a row is clicked.
 *
 * Admin-gated because audit logs surface IPs and actor UUIDs across the org.
 * Non-admins land on a clean explanation instead of a hard 403.
 */
export function AuditLogTab() {
  const roleLoading = useCurrentRoleLoading()
  const isAdmin = useIsAdmin()
  const [timeWindow, setTimeWindow] = useState<AuditTimeWindow>('30d')
  const [actionFilter, setActionFilter] = useState<string>('')
  const [page, setPage] = useState(0)

  const params: UseAuditLogsParams = useMemo(() => {
    // exactOptionalPropertyTypes: true — only set keys we have values for.
    const next: UseAuditLogsParams = {
      limit: PAGE_SIZE_AUDIT,
      offset: page * PAGE_SIZE_AUDIT,
    }
    if (actionFilter) next.action = actionFilter
    const from = auditWindowToFrom(timeWindow)
    if (from) next.from = from
    return next
  }, [actionFilter, timeWindow, page])

  const query = useAuditLogsPage(params, { enabled: isAdmin })
  const actionsQuery = useAuditLogActions()
  // Stabilise `rows` so the dependent useMemo doesn't recompute every render.
  // The `?? []` on the raw expression would create a fresh array on each call
  // and bust memoisation downstream.
  const rows = useMemo(() => query.data?.rows ?? [], [query.data?.rows])
  const total = query.data?.meta.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE_AUDIT))
  const showingFrom = total === 0 ? 0 : page * PAGE_SIZE_AUDIT + 1
  const showingTo = Math.min(total, page * PAGE_SIZE_AUDIT + PAGE_SIZE_AUDIT)

  const bySev = useMemo(() => ({
    high: rows.filter((e) => inferAuditSeverity(e.action) === 'high').length,
    med:  rows.filter((e) => inferAuditSeverity(e.action) === 'med').length,
    low:  rows.filter((e) => inferAuditSeverity(e.action) === 'low').length,
  }), [rows])

  if (roleLoading) {
    return (
      <div className="max-w-[980px]">
        <TabHeader title="Audit log" description="Checking permissions…" />
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className="max-w-[980px]">
        <TabHeader
          title="Audit log"
          description="Every state change in the workspace. Immutable · service-role writes only."
        />
        <div className="rounded-lg border border-border bg-bg-elev p-6">
          <div className="font-mono text-[12.5px] text-text mb-2">Admin only</div>
          <div className="font-mono text-[11.5px] text-text-muted">
            The full audit log viewer is restricted to workspace admins. Audit rows
            surface actor IDs and IP addresses across every member — only admins
            can see them. Editors and viewers don&apos;t lose the ability to act;
            they just can&apos;t inspect history here.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-[980px]">
      <TabHeader
        title="Audit log"
        description="Every state change in the workspace. Immutable · service-role writes only."
      />

      <div className="grid grid-cols-3 gap-3 mb-5">
        {[
          { k: 'HIGH', n: bySev.high, sub: 'billing · auth · destructive', accent: true },
          { k: 'MED',  n: bySev.med,  sub: 'create · update · invite',     accent: false },
          { k: 'LOW',  n: bySev.low,  sub: 'other events',                 accent: false },
        ].map((s) => (
          <div key={s.k} className={cn('border rounded-lg p-3', s.accent ? 'border-accent-border bg-accent-bg' : 'border-border bg-bg-elev')}>
            <div className="flex items-baseline justify-between">
              <span className={cn('font-mono text-[10px] tracking-[0.05em]', s.accent ? 'text-accent' : 'text-text-faint')}>{s.k}</span>
              <span className="font-mono text-[22px] font-medium text-text">{s.n}</span>
            </div>
            <div className="font-mono text-[10.5px] text-text-muted mt-1">{s.sub}</div>
          </div>
        ))}
      </div>

      <Section
        title="Events"
        action={(
          <div className="flex items-center gap-2">
            <select
              value={timeWindow}
              onChange={(e) => { setTimeWindow(e.target.value as AuditTimeWindow); setPage(0) }}
              className="bg-bg-elev border border-border rounded-[5px] px-2 py-1 font-mono text-[11px] text-text"
            >
              {AUDIT_TIME_WINDOWS.map((w) => (
                <option key={w.value} value={w.value}>{w.label}</option>
              ))}
            </select>
            <select
              value={actionFilter}
              onChange={(e) => { setActionFilter(e.target.value); setPage(0) }}
              className="bg-bg-elev border border-border rounded-[5px] px-2 py-1 font-mono text-[11px] text-text min-w-[180px]"
            >
              <option value="">All actions</option>
              {(actionsQuery.data ?? []).map((action) => (
                <option key={action} value={action}>{action}</option>
              ))}
            </select>
          </div>
        )}
        className="mb-5"
      >
        <AuditLogsTable
          rows={rows}
          isLoading={query.isLoading}
          emptyHint={
            actionFilter || timeWindow !== 'all'
              ? 'No events match the current filters. Try widening the time range.'
              : 'No audit events yet.'
          }
        />

        {total > 0 && (
          <div className="border-t border-border px-6 py-3 flex items-center justify-between text-[11.5px] font-mono">
            <span className="text-text-faint">
              Showing {showingFrom}–{showingTo} of {total.toLocaleString('en-US')}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                className={cn(
                  'rounded-[5px] border border-border px-2 py-1 text-[11px]',
                  page === 0 ? 'opacity-40 cursor-not-allowed' : 'hover:bg-bg-muted',
                )}
              >
                ← Prev
              </button>
              <span className="text-text-faint px-2">
                Page {page + 1} / {pageCount}
              </span>
              <button
                type="button"
                disabled={page + 1 >= pageCount}
                onClick={() => setPage((p) => p + 1)}
                className={cn(
                  'rounded-[5px] border border-border px-2 py-1 text-[11px]',
                  page + 1 >= pageCount ? 'opacity-40 cursor-not-allowed' : 'hover:bg-bg-muted',
                )}
              >
                Next →
              </button>
            </div>
          </div>
        )}
      </Section>
    </div>
  )
}
