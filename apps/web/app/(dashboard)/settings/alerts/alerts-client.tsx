'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, AlertCircle, Info, CheckCircle, Loader2 } from 'lucide-react'
import { Topbar } from '@/components/layout/topbar'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import {
  useInternalAlerts,
  useResolveAlert,
  type AlertSeverity,
  type InternalAlert,
} from '@/lib/queries/use-internal-alerts'

/**
 * Spanlens operator alerts queue (R-Q2).
 *
 * Shows unresolved internal_alerts rows by default with a toggle for
 * the resolved history. Each row carries the cron-emitted message plus
 * the structured `details` JSON for inspection.
 *
 * Laid out as the D25 board: one hairline-split stat strip over a card of
 * rows. The strip tallies the loaded window rather than issuing a second
 * query, so it always agrees with the list underneath it.
 *
 * Access control: API returns 403 unless the user's email is in
 * SPANLENS_ADMIN_EMAILS. We render the page shell either way and let
 * the query surface "Permission denied" — the page link is hidden
 * from non-admin sidebars upstream of this client.
 */

const SEVERITY_STYLE: Record<AlertSeverity, string> = {
  info: 'bg-bg-chip text-text-muted',
  warn: 'bg-warn-bg text-warn',
  error: 'bg-bad-bg text-bad',
}

function SeverityBadge({ severity }: { severity: AlertSeverity }) {
  const Icon = severity === 'error' ? AlertCircle : severity === 'warn' ? AlertTriangle : Info
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-[3px] font-mono text-[10.5px] uppercase tracking-[0.04em]',
        SEVERITY_STYLE[severity],
      )}
    >
      <Icon className="h-3 w-3" />
      {severity}
    </span>
  )
}

function formatAge(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  if (diffMs < 60_000) return `${Math.round(diffMs / 1000)}s ago`
  if (diffMs < 3_600_000) return `${Math.round(diffMs / 60_000)}m ago`
  if (diffMs < 86_400_000) return `${Math.round(diffMs / 3_600_000)}h ago`
  return `${Math.round(diffMs / 86_400_000)}d ago`
}

function AlertRow({
  alert,
  onResolve,
  resolving,
}: {
  alert: InternalAlert
  onResolve: (id: string) => void
  resolving: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const hasDetails = Object.keys(alert.details).length > 0

  return (
    <div className="flex items-start justify-between gap-3 border-b border-border px-[18px] py-3.5 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex items-center gap-2">
          <SeverityBadge severity={alert.severity} />
          <span className="font-mono text-[11px] text-text-faint">{alert.kind}</span>
          <span className="font-mono text-[11px] text-text-faint">
            · {formatAge(alert.created_at)}
          </span>
        </div>
        <p className="break-words text-[12.5px] text-text">{alert.message}</p>
        {hasDetails && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="mt-2 font-mono text-[11px] text-text-faint hover:text-text-muted"
          >
            {expanded ? '▾ Hide details' : '▸ Show details'}
          </button>
        )}
        {hasDetails && expanded && (
          <pre className="mt-2 overflow-x-auto rounded-lg bg-bg-sunk px-4 py-3.5 font-mono text-[11.5px] text-text-muted">
            {JSON.stringify(alert.details, null, 2)}
          </pre>
        )}
      </div>
      {alert.resolved_at ? (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-good-bg px-2 py-[3px] font-mono text-[10.5px] uppercase tracking-[0.04em] text-good">
          <CheckCircle className="h-3 w-3" />
          resolved
        </span>
      ) : (
        <button
          onClick={() => onResolve(alert.id)}
          disabled={resolving}
          className="shrink-0 rounded-full border border-border bg-bg-elev px-3.5 py-2 text-[12px] font-medium text-text hover:bg-bg-muted disabled:opacity-50"
        >
          {resolving ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Resolve'}
        </button>
      )}
    </div>
  )
}

export function AlertsClient() {
  const [showResolved, setShowResolved] = useState(false)
  const query = useInternalAlerts(!showResolved)
  const resolve = useResolveAlert()
  const alerts = useMemo(() => query.data ?? [], [query.data])

  // Counting both resolution states keeps the cells honest under either
  // filter: the "All (recent)" view mixes them, the default view does not.
  const stats = useMemo(() => {
    const by = (fn: (a: InternalAlert) => boolean) => alerts.filter(fn).length
    return {
      total: alerts.length,
      error: by((a) => a.severity === 'error'),
      warn: by((a) => a.severity === 'warn'),
      info: by((a) => a.severity === 'info'),
      unresolved: by((a) => !a.resolved_at),
      resolved: by((a) => Boolean(a.resolved_at)),
    }
  }, [alerts])

  return (
    <>
      {/* The topbar is the only full-bleed row: it cancels the padding
          `DashboardContent` applies so its hairline spans the whole main
          column. Everything below sits flush inside that padding. */}
      <div className="sticky top-0 z-20 -mx-4 -mt-4 md:-mx-7 md:-mt-5 bg-bg">
        <Topbar
          crumbs={[
            { label: 'Settings', href: '/settings' },
            { label: 'Internal alerts' },
          ]}
          right={
            query.isFetching ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-text-faint" />
            ) : undefined
          }
        />
      </div>

      <div className="space-y-4 pt-4 md:pt-5">
        <p className="max-w-[680px] text-[12.5px] leading-[1.55] text-text-muted">
          Spanlens operator queue. Surfaces Spanlens-wide problems detected
          by cron jobs (missing model prices, orphan spans, fallback queue
          buildup, webhook backlog). Resolving an entry is a soft
          acknowledgement: the next cron run can re-fire if the underlying
          condition is still present.
        </p>

        <div className="overflow-x-auto rounded-card border border-border bg-bg-elev shadow-card">
          <div className="grid min-w-[560px] grid-cols-3 divide-x divide-border lg:min-w-0 lg:grid-cols-6">
            <StatCell label="ALERTS" value={stats.total} note="in view" />
            <StatCell label="UNRESOLVED" value={stats.unresolved} note="open" />
            <StatCell label="ERROR" value={stats.error} note="severity" />
            <StatCell label="WARN" value={stats.warn} note="severity" />
            <StatCell label="INFO" value={stats.info} note="severity" />
            <StatCell label="RESOLVED" value={stats.resolved} note="acknowledged" />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowResolved(false)}
            className={cn(
              'rounded-full px-3.5 py-2 text-[12px] font-medium transition-colors',
              !showResolved
                ? 'bg-text text-bg'
                : 'border border-border bg-bg-elev text-text hover:bg-bg-muted',
            )}
          >
            Unresolved
          </button>
          <button
            onClick={() => setShowResolved(true)}
            className={cn(
              'rounded-full px-3.5 py-2 text-[12px] font-medium transition-colors',
              showResolved
                ? 'bg-text text-bg'
                : 'border border-border bg-bg-elev text-text hover:bg-bg-muted',
            )}
          >
            All (recent)
          </button>
        </div>

        {query.isLoading && (
          <div className="rounded-card border border-border bg-bg-elev p-6 text-center font-mono text-[12px] text-text-faint shadow-card">
            Loading…
          </div>
        )}

        {query.isError && (
          <div className="rounded-card border border-accent-border bg-bad-bg p-6 text-[12.5px] text-bad">
            Failed to load alerts.
            {' '}
            {query.error instanceof Error ? query.error.message : 'Unknown error.'}
          </div>
        )}

        {!query.isLoading && !query.isError && alerts.length === 0 && (
          <div className="rounded-card border border-border bg-bg-elev p-8 text-center shadow-card">
            <CheckCircle className="mx-auto h-6 w-6 text-good" />
            <p className="mt-2 text-[12.5px] text-text">All clear.</p>
            <p className="mt-1 font-mono text-[11px] text-text-faint">
              No {showResolved ? 'alerts in the recent window' : 'unresolved alerts'}.
            </p>
          </div>
        )}

        {alerts.length > 0 && (
          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle>Queue</CardTitle>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              <div className="border-t border-border">
                {alerts.map((alert) => (
                  <AlertRow
                    key={alert.id}
                    alert={alert}
                    onResolve={(id) => resolve.mutate(id)}
                    resolving={resolve.isPending && resolve.variables === alert.id}
                  />
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  )
}

function StatCell({ label, value, note }: { label: string; value: number; note: string }) {
  return (
    <div className="px-5 py-[18px]">
      <div className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-text-faint">
        {label}
      </div>
      <div className="track-h3 mt-[7px] font-display text-[22px] leading-[1.05] text-text">
        {value}
      </div>
      <div className="mt-[7px] text-[11.5px] font-medium text-text-faint">{note}</div>
    </div>
  )
}
