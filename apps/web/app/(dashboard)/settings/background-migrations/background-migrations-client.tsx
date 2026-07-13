'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Play, Square, RotateCcw, AlertTriangle, CheckCircle, Loader2 } from 'lucide-react'
import { Topbar } from '@/components/layout/topbar'
import { cn, formatDateTime } from '@/lib/utils'
import {
  useBackgroundMigrations,
  useCancelBackgroundMigration,
  useRetryBackgroundMigration,
  type BackgroundMigration,
} from '@/lib/queries/use-background-migrations'

/**
 * Admin-only view of the background migration framework.
 *
 * Auto-refreshes every 30s while open (see the hook). Each row shows
 * status, progress %, last heartbeat, and exposes cancel / retry
 * buttons depending on the current state. Rows whose `registered`
 * flag is false are flagged with an "unregistered" warning — the
 * code-side registration was removed but the DB row stayed, so the
 * runner is silently skipping it.
 */

const STATUS_STYLE: Record<BackgroundMigration['status'], string> = {
  pending: 'border-border bg-bg-elev text-text-muted',
  running: 'border-accent bg-accent-bg/40 text-text',
  completed: 'border-good/40 bg-good/10 text-good',
  failed: 'border-bad/40 bg-bad/10 text-bad',
  cancelled: 'border-border bg-bg-elev text-text-faint',
}

function StatusBadge({ status }: { status: BackgroundMigration['status'] }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-[5px] border px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.04em]',
        STATUS_STYLE[status],
      )}
    >
      {status === 'running' && <Loader2 className="h-3 w-3 animate-spin" />}
      {status === 'completed' && <CheckCircle className="h-3 w-3" />}
      {status === 'failed' && <AlertTriangle className="h-3 w-3" />}
      {status}
    </span>
  )
}

function formatProgress(row: BackgroundMigration): string {
  if (row.progress_total == null || row.progress_current == null) return '—'
  const pct = row.progress_total > 0 ? (row.progress_current / row.progress_total) * 100 : 0
  return `${row.progress_current.toLocaleString()} / ${row.progress_total.toLocaleString()} (${pct.toFixed(1)}%)`
}

function formatHeartbeat(iso: string | null): string {
  if (!iso) return 'never'
  const diffMs = Date.now() - new Date(iso).getTime()
  if (diffMs < 60_000) return `${Math.round(diffMs / 1000)}s ago`
  if (diffMs < 3_600_000) return `${Math.round(diffMs / 60_000)}m ago`
  return `${Math.round(diffMs / 3_600_000)}h ago`
}

export function BackgroundMigrationsClient() {
  const query = useBackgroundMigrations()
  const cancel = useCancelBackgroundMigration()
  const retry = useRetryBackgroundMigration()
  const [confirmingCancel, setConfirmingCancel] = useState<string | null>(null)

  const rows = query.data?.data ?? []
  const unseeded = query.data?.unseededRegistrations ?? []

  return (
    <>
      <Topbar
        crumbs={[
          { label: 'Settings', href: '/settings' },
          { label: 'Background migrations' },
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
          <h1 className="mt-2 text-2xl font-semibold">Background migrations</h1>
          <p className="mt-1 text-[13px] text-text-muted max-w-[680px]">
            Long-running data backfills processed in 5-minute chunks by the
            cron at <code className="text-text">/cron/run-background-migrations</code>.
            Auto-refreshes every 30s.
          </p>
        </div>

        {unseeded.length > 0 && (
          <div className="mb-4 rounded-[6px] border border-warn/40 bg-warn/10 px-3 py-2 font-mono text-[11.5px] text-warn">
            <p className="mb-1 font-medium">Registered in code, no DB row yet:</p>
            <ul className="list-disc pl-4">
              {unseeded.map((name) => (
                <li key={name}>
                  <code className="text-text">{name}</code> — seed via SQL to start it.
                </li>
              ))}
            </ul>
          </div>
        )}

        {query.isLoading ? (
          <div className="space-y-2">
            {[1, 2].map((i) => (
              <div key={i} className="h-20 rounded-[6px] bg-bg-elev animate-pulse" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-[6px] border border-border bg-bg p-10 text-center">
            <p className="text-[13px] text-text mb-1">No background migrations have been seeded yet.</p>
            <p className="font-mono text-[11.5px] text-text-faint">
              When one ships, an INSERT into <code className="text-text">background_migrations</code>{' '}
              will surface it here.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {rows.map((row) => (
              <div
                key={row.name}
                className={cn(
                  'rounded-[6px] border border-border bg-bg p-4',
                  !row.registered && 'opacity-70',
                )}
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <code className="font-mono text-[12.5px] text-text">{row.name}</code>
                      <StatusBadge status={row.status} />
                      {!row.registered && (
                        <span className="rounded-[4px] bg-warn/15 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.04em] text-warn">
                          unregistered
                        </span>
                      )}
                    </div>
                    <p className="font-mono text-[11px] text-text-muted">{row.description}</p>
                  </div>

                  <div className="flex items-center gap-1">
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
                        className="inline-flex items-center gap-1 rounded-[5px] border border-border px-2 py-1 font-mono text-[11px] text-text-muted hover:bg-bg-elev hover:text-bad transition-colors"
                      >
                        <Square className="h-3 w-3" />
                        {confirmingCancel === row.name ? 'confirm cancel' : 'cancel'}
                      </button>
                    )}
                    {(row.status === 'failed' || row.status === 'cancelled') && (
                      <button
                        type="button"
                        onClick={() => retry.mutate(row.name)}
                        className="inline-flex items-center gap-1 rounded-[5px] border border-border px-2 py-1 font-mono text-[11px] text-text-muted hover:bg-bg-elev hover:text-text transition-colors"
                      >
                        {row.status === 'failed' ? (
                          <RotateCcw className="h-3 w-3" />
                        ) : (
                          <Play className="h-3 w-3" />
                        )}
                        retry
                      </button>
                    )}
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1 font-mono text-[10.5px]">
                  <Field label="progress" value={formatProgress(row)} />
                  <Field label="heartbeat" value={formatHeartbeat(row.last_heartbeat_at)} />
                  <Field label="attempts" value={String(row.attempts)} />
                  <Field
                    label="started"
                    value={formatDateTime(row.started_at)}
                  />
                </div>

                {row.error_message && (
                  <div className="mt-2 rounded-[4px] bg-bad/10 px-2 py-1 font-mono text-[11px] text-bad">
                    error: {row.error_message}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="uppercase tracking-[0.04em] text-text-faint">{label}: </span>
      <span className="text-text-muted">{value}</span>
    </div>
  )
}
