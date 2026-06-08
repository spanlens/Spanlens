'use client'

import Link from 'next/link'
import { useState } from 'react'
import { AlertTriangle, AlertCircle, Info, CheckCircle, Loader2 } from 'lucide-react'
import { Topbar } from '@/components/layout/topbar'
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
 * Access control: API returns 403 unless the user's email is in
 * SPANLENS_ADMIN_EMAILS. We render the page shell either way and let
 * the query surface "Permission denied" — the page link is hidden
 * from non-admin sidebars upstream of this client.
 */

const SEVERITY_STYLE: Record<AlertSeverity, string> = {
  info: 'border-border bg-bg-elev text-text-muted',
  warn: 'border-amber-500/40 bg-amber-500/10 text-amber-500',
  error: 'border-bad/40 bg-bad/10 text-bad',
}

function SeverityBadge({ severity }: { severity: AlertSeverity }) {
  const Icon = severity === 'error' ? AlertCircle : severity === 'warn' ? AlertTriangle : Info
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-[5px] border px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.04em]',
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
    <div className="border border-border rounded-lg overflow-hidden">
      <div className="flex items-start justify-between gap-3 p-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <SeverityBadge severity={alert.severity} />
            <span className="font-mono text-[11px] text-text-faint">{alert.kind}</span>
            <span className="font-mono text-[11px] text-text-faint">
              · {formatAge(alert.created_at)}
            </span>
          </div>
          <p className="text-[13px] text-text break-words">{alert.message}</p>
          {hasDetails && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="mt-2 font-mono text-[11px] text-text-faint hover:text-text-muted"
            >
              {expanded ? '▾ Hide details' : '▸ Show details'}
            </button>
          )}
          {hasDetails && expanded && (
            <pre className="mt-2 overflow-x-auto rounded-md bg-bg-elev p-3 font-mono text-[11px] text-text-muted">
              {JSON.stringify(alert.details, null, 2)}
            </pre>
          )}
        </div>
        {alert.resolved_at ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-[5px] border border-good/40 bg-good/10 px-2 py-1 font-mono text-[10.5px] uppercase tracking-[0.04em] text-good">
            <CheckCircle className="h-3 w-3" />
            resolved
          </span>
        ) : (
          <button
            onClick={() => onResolve(alert.id)}
            disabled={resolving}
            className="shrink-0 rounded-md border border-border bg-bg-elev px-3 py-1.5 font-mono text-[11px] hover:bg-bg-hover disabled:opacity-50"
          >
            {resolving ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Resolve'}
          </button>
        )}
      </div>
    </div>
  )
}

export function AlertsClient() {
  const [showResolved, setShowResolved] = useState(false)
  const query = useInternalAlerts(!showResolved)
  const resolve = useResolveAlert()
  const alerts = query.data ?? []

  return (
    <>
      <Topbar
        crumbs={[
          { label: 'Settings', href: '/settings' },
          { label: 'Internal alerts' },
        ]}
      />
      <div className="px-6 py-8 max-w-[1100px] mx-auto">
        <div className="mb-6">
          <Link
            href="/settings"
            className="font-mono text-[11px] text-text-faint hover:text-text-muted"
          >
            ← Settings
          </Link>
          <h1 className="mt-2 text-2xl font-semibold">Internal alerts</h1>
          <p className="mt-1 text-[13px] text-text-muted max-w-[680px]">
            Spanlens operator queue. Surfaces Spanlens-wide problems detected
            by cron jobs (missing model prices, orphan spans, fallback queue
            buildup, webhook backlog). Resolving an entry is a soft
            acknowledgement: the next cron run can re-fire if the underlying
            condition is still present.
          </p>
        </div>

        <div className="mb-4 flex items-center gap-2">
          <button
            onClick={() => setShowResolved(false)}
            className={cn(
              'rounded-md border px-3 py-1.5 font-mono text-[11px]',
              !showResolved
                ? 'border-accent bg-accent-bg/40 text-text'
                : 'border-border bg-bg-elev text-text-muted hover:text-text',
            )}
          >
            Unresolved
          </button>
          <button
            onClick={() => setShowResolved(true)}
            className={cn(
              'rounded-md border px-3 py-1.5 font-mono text-[11px]',
              showResolved
                ? 'border-accent bg-accent-bg/40 text-text'
                : 'border-border bg-bg-elev text-text-muted hover:text-text',
            )}
          >
            All (recent)
          </button>
          {query.isFetching && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-text-faint" />
          )}
        </div>

        {query.isLoading && (
          <div className="rounded-lg border border-border bg-bg-elev p-6 text-center font-mono text-[12px] text-text-faint">
            Loading…
          </div>
        )}

        {query.isError && (
          <div className="rounded-lg border border-bad/40 bg-bad/10 p-6 text-[13px] text-bad">
            Failed to load alerts.
            {' '}
            {query.error instanceof Error ? query.error.message : 'Unknown error.'}
          </div>
        )}

        {!query.isLoading && !query.isError && alerts.length === 0 && (
          <div className="rounded-lg border border-border bg-bg-elev p-8 text-center">
            <CheckCircle className="mx-auto h-6 w-6 text-good" />
            <p className="mt-2 text-[13px] text-text">All clear.</p>
            <p className="mt-1 font-mono text-[11px] text-text-faint">
              No {showResolved ? 'alerts in the recent window' : 'unresolved alerts'}.
            </p>
          </div>
        )}

        <div className="space-y-3">
          {alerts.map((alert) => (
            <AlertRow
              key={alert.id}
              alert={alert}
              onResolve={(id) => resolve.mutate(id)}
              resolving={resolve.isPending && resolve.variables === alert.id}
            />
          ))}
        </div>
      </div>
    </>
  )
}
