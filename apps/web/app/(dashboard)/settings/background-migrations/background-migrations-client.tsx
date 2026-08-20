'use client'

import { useMemo, useState } from 'react'
import { Play, Square, RotateCcw, AlertTriangle, CheckCircle, Loader2 } from 'lucide-react'
import { Topbar } from '@/components/layout/topbar'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn, formatDateTime } from '@/lib/utils'
import {
  useBackgroundMigrations,
  useCancelBackgroundMigration,
  useRetryBackgroundMigration,
  type BackgroundMigration,
} from '@/lib/queries/use-background-migrations'

/**
 * Admin-only view of the background migration framework (D27 board).
 *
 * Auto-refreshes every 30s while open (see the hook). The table shows
 * status, progress, last heartbeat, and exposes cancel / retry buttons
 * depending on the current state. Cancel keeps its two-step confirm: these
 * jobs rewrite production rows, so an accidental single click must not stop
 * one mid-chunk.
 *
 * Rows whose `registered` flag is false are flagged with an "unregistered"
 * warning — the code-side registration was removed but the DB row stayed, so
 * the runner is silently skipping it.
 */

const STATUS_PILL: Record<BackgroundMigration['status'], string> = {
  pending: 'bg-bg-chip text-text-muted',
  running: 'bg-warn-bg text-warn',
  completed: 'bg-good-bg text-good',
  failed: 'bg-accent-bg text-accent',
  cancelled: 'bg-bg-chip text-text-faint',
}

function StatusBadge({ status }: { status: BackgroundMigration['status'] }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-[3px] font-mono text-[10.5px]',
        STATUS_PILL[status],
      )}
    >
      {status === 'running' && <Loader2 className="h-3 w-3 animate-spin" />}
      {status === 'completed' && <CheckCircle className="h-3 w-3" />}
      {status === 'failed' && <AlertTriangle className="h-3 w-3" />}
      {status}
    </span>
  )
}

// Percent complete, or null when the runner has not reported a denominator
// yet. Callers render an empty meter in that case rather than guessing.
function progressPct(row: BackgroundMigration): number | null {
  if (row.progress_total == null || row.progress_current == null) return null
  if (row.progress_total <= 0) return 0
  return Math.min(100, (row.progress_current / row.progress_total) * 100)
}

function formatHeartbeat(iso: string | null): string {
  if (!iso) return 'never'
  const diffMs = Date.now() - new Date(iso).getTime()
  if (diffMs < 60_000) return `${Math.round(diffMs / 1000)}s ago`
  if (diffMs < 3_600_000) return `${Math.round(diffMs / 60_000)}m ago`
  return `${Math.round(diffMs / 3_600_000)}h ago`
}

const ROW_GRID = 'grid grid-cols-[1.7fr_0.7fr_1.2fr_1.1fr_0.8fr_auto] items-center gap-3'

export function BackgroundMigrationsClient() {
  const query = useBackgroundMigrations()
  const cancel = useCancelBackgroundMigration()
  const retry = useRetryBackgroundMigration()
  const [confirmingCancel, setConfirmingCancel] = useState<string | null>(null)

  const rows = useMemo(() => query.data?.data ?? [], [query.data])
  const unseeded = query.data?.unseededRegistrations ?? []

  const counts = useMemo(() => {
    const by = (status: BackgroundMigration['status']) =>
      rows.filter((r) => r.status === status).length
    return {
      pending: by('pending'),
      running: by('running'),
      completed: by('completed'),
      failed: by('failed'),
      cancelled: by('cancelled'),
    }
  }, [rows])

  // The console block only earns its space when the runner actually left an
  // error behind; there is no continuous log stream to tail.
  const errored = rows.filter((r) => r.error_message)

  return (
    <>
      {/* The topbar is the only full-bleed row: it cancels the padding
          `DashboardContent` applies so its hairline spans the whole main
          column. Everything below sits flush inside that padding. */}
      <div className="sticky top-0 z-20 -mx-4 -mt-4 md:-mx-7 md:-mt-5 bg-bg">
        <Topbar
          crumbs={[
            { label: 'Settings', href: '/settings' },
            { label: 'Background migrations' },
          ]}
        />
      </div>

      <div className="space-y-4 pt-4 md:pt-5">
        <p className="max-w-[680px] text-[12.5px] leading-[1.55] text-text-muted">
          Long-running data backfills processed in 5-minute chunks by the
          cron at <code className="font-mono text-text">/cron/run-background-migrations</code>.
          Auto-refreshes every 30s.
        </p>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="QUEUED" value={counts.pending} tone="warn" note="waiting for a chunk" />
          <StatCard label="RUNNING" value={counts.running} tone="warn" note="in flight" />
          <StatCard label="COMPLETED" value={counts.completed} tone="good" note="finished" />
          <StatCard
            label="FAILED"
            value={counts.failed}
            note={counts.cancelled > 0 ? `${counts.cancelled} cancelled` : 'none cancelled'}
          />
        </div>

        {unseeded.length > 0 && (
          <div className="flex items-start gap-2.5 rounded-card border border-warn/25 bg-warn-bg px-5 py-3.5">
            <span className="mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full bg-warn" />
            <div className="text-[12.5px] leading-[1.5] text-text">
              <p className="mb-1 font-medium">Registered in code, no DB row yet:</p>
              <ul className="list-disc pl-4">
                {unseeded.map((name) => (
                  <li key={name}>
                    <code className="font-mono text-text">{name}</code> — seed via SQL to start it.
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {query.isLoading ? (
          <div className="space-y-2">
            {[1, 2].map((i) => (
              <div key={i} className="h-20 rounded-card bg-bg-chip animate-pulse" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-card border border-border bg-bg-elev p-10 text-center shadow-card">
            <p className="mb-1 text-[12.5px] text-text">No background migrations have been seeded yet.</p>
            <p className="font-mono text-[11.5px] text-text-faint">
              When one ships, an INSERT into <code className="text-text">background_migrations</code>{' '}
              will surface it here.
            </p>
          </div>
        ) : (
          <div className="rounded-card border border-border bg-bg-elev shadow-card">
            <div className="overflow-x-auto">
              <div className="min-w-[860px]">
                <div className={cn(ROW_GRID, 'border-b border-border bg-bg-muted px-[18px] py-2.5')}>
                  <span className="micro-label">Migration</span>
                  <span className="micro-label">Rows</span>
                  <span className="micro-label">Progress</span>
                  <span className="micro-label">Started</span>
                  <span className="micro-label">Status</span>
                  <span className="micro-label" />
                </div>

                {rows.map((row) => {
                  const pct = progressPct(row)
                  const done = pct != null && pct >= 100
                  return (
                    <div
                      key={row.name}
                      className={cn(
                        ROW_GRID,
                        'border-b border-border px-[18px] py-3 last:border-b-0',
                        !row.registered && 'opacity-70',
                      )}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <code className="truncate font-mono text-[12px] text-text">{row.name}</code>
                          {!row.registered && (
                            <span className="shrink-0 rounded-full bg-warn-bg px-2 py-[3px] font-mono text-[10px] uppercase tracking-[0.04em] text-warn">
                              unregistered
                            </span>
                          )}
                        </div>
                        <div className="truncate text-[11.5px] text-text-muted">
                          {row.description}
                        </div>
                        <div className="font-mono text-[11px] text-text-faint">
                          heartbeat {formatHeartbeat(row.last_heartbeat_at)} · {row.attempts} attempts
                        </div>
                      </div>

                      <span className="font-mono text-[12px] text-text-muted">
                        {row.progress_total?.toLocaleString() ?? 'n/a'}
                      </span>

                      <div className="flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-track">
                          <div
                            className={cn('h-full rounded-full', done ? 'bg-good' : 'bg-accent')}
                            style={{ width: `${pct ?? 0}%` }}
                          />
                        </div>
                        <span className="shrink-0 font-mono text-[12px] text-text-muted">
                          {pct == null ? 'n/a' : `${pct.toFixed(0)}%`}
                        </span>
                      </div>

                      <span className="font-mono text-[12px] text-text-muted">
                        {formatDateTime(row.started_at)}
                      </span>

                      <span>
                        <StatusBadge status={row.status} />
                      </span>

                      <span className="flex items-center justify-end gap-2">
                        {(row.status === 'pending' || row.status === 'running') && (
                          <button
                            type="button"
                            onClick={() => {
                              if (confirmingCancel === row.name) {
                                cancel.mutate(row.name)
                                setConfirmingCancel(null)
                              } else {
                                setConfirmingCancel(row.name)
                              }
                            }}
                            className={cn(
                              'inline-flex items-center gap-1 rounded-full px-3.5 py-2 text-[12px] font-medium transition-colors',
                              confirmingCancel === row.name
                                ? 'border border-accent-border bg-accent-bg text-accent'
                                : 'border border-border bg-bg-elev text-text hover:bg-bg-muted',
                            )}
                          >
                            <Square className="h-3 w-3" />
                            {confirmingCancel === row.name ? 'confirm cancel' : 'cancel'}
                          </button>
                        )}
                        {(row.status === 'failed' || row.status === 'cancelled') && (
                          <button
                            type="button"
                            onClick={() => retry.mutate(row.name)}
                            className="inline-flex items-center gap-1 rounded-full border border-border bg-bg-elev px-3.5 py-2 text-[12px] font-medium text-text transition-colors hover:bg-bg-muted"
                          >
                            {row.status === 'failed' ? (
                              <RotateCcw className="h-3 w-3" />
                            ) : (
                              <Play className="h-3 w-3" />
                            )}
                            retry
                          </button>
                        )}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {errored.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Last error</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-lg bg-bg-sunk px-4 py-3.5">
                {errored.map((row) => (
                  <div key={row.name} className="font-mono text-[11.5px] leading-[1.7] text-text-faint">
                    <span className="text-text">{row.name}</span>{' '}
                    <span className="text-warn">{row.error_message}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  )
}

function StatCard({
  label,
  value,
  note,
  tone,
}: {
  label: string
  value: number
  note: string
  tone?: 'warn' | 'good'
}) {
  // Zero is never worth colouring: an empty queue is the boring good case.
  const valueTone =
    value === 0 || !tone ? 'text-text' : tone === 'warn' ? 'text-warn' : 'text-good'
  return (
    <div className="rounded-card border border-border bg-bg-elev px-5 py-[18px] shadow-card">
      <div className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-text-faint">
        {label}
      </div>
      <div className={cn('track-h3 mt-[7px] font-display text-[22px] leading-[1.05]', valueTone)}>
        {value}
      </div>
      <div className="mt-[7px] text-[11.5px] font-medium text-text-faint">{note}</div>
    </div>
  )
}
