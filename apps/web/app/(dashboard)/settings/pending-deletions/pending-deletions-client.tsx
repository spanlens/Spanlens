'use client'

import Link from 'next/link'
import { useState } from 'react'
import {
  usePendingDeletions,
  usePendingDeletionsHistory,
  useRestorePendingDeletion,
  type PendingDeletionRow,
  type PendingResourceType,
} from '@/lib/queries/use-pending-deletions'
import { useCurrentRole } from '@/lib/queries/use-current-role'
import { Topbar } from '@/components/layout/topbar'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn, formatDate } from '@/lib/utils'

/**
 * Pending deletion queue (D26 board).
 *
 * Restyled onto the table-card language, but the two-step Restore confirm is
 * left exactly as it was: this queue is the last stop before an irreversible
 * delete, so the second click stays a deliberate act rather than a hover
 * target.
 */

const RESOURCE_LABELS: Record<PendingResourceType, string> = {
  api_key: 'API Key',
  provider_key: 'Provider Key',
  prompt_version: 'Prompt Version',
}

function snapshotName(row: PendingDeletionRow): string {
  const snap = row.resourceSnapshot
  if (typeof snap.name === 'string') return snap.name
  if (row.resourceType === 'prompt_version') {
    const name = typeof snap.name === 'string' ? snap.name : 'unnamed'
    const version = typeof snap.version === 'number' ? snap.version : '?'
    return `${name} v${version}`
  }
  return row.resourceId.slice(0, 8)
}

function formatRemaining(scheduledFor: string): {
  text: string
  tone: 'safe' | 'warn' | 'danger' | 'expired'
} {
  const target = new Date(scheduledFor).getTime()
  const now = Date.now()
  const diffMs = target - now

  if (diffMs <= 0) return { text: 'Executing soon', tone: 'expired' }

  const hours = Math.floor(diffMs / (60 * 60 * 1000))
  const days = Math.floor(hours / 24)

  let text: string
  if (days >= 2) text = `${days}d remaining`
  else if (hours >= 24) text = `${days}d ${hours % 24}h remaining`
  else if (hours >= 1) text = `${hours}h remaining`
  else text = '<1h remaining'

  if (hours < 6) return { text, tone: 'danger' }
  if (hours < 24) return { text, tone: 'warn' }
  return { text, tone: 'safe' }
}

// Compact elapsed time for the REQUESTED column. Client-only render, so
// reading the clock here can't diverge from an SSR pass.
function formatAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const hours = Math.floor(diffMs / (60 * 60 * 1000))
  if (hours < 1) return 'just now'
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

const TONE_CLASS = {
  safe: 'text-good',
  warn: 'text-warn',
  danger: 'text-bad',
  expired: 'text-text-faint',
}

const ROW_GRID = 'grid grid-cols-[1.4fr_1fr_1fr_0.9fr_1fr_auto] items-center gap-3'

export function PendingDeletionsClient() {
  const role = useCurrentRole()
  const canRestore = role === 'admin' || role === 'editor'
  const active = usePendingDeletions()
  const history = usePendingDeletionsHistory()
  const restore = useRestorePendingDeletion()
  const [confirming, setConfirming] = useState<string | null>(null)

  return (
    <>
      {/* The topbar is the only full-bleed row: it cancels the padding
          `DashboardContent` applies so its hairline spans the whole main
          column. Everything below sits flush inside that padding. */}
      <div className="sticky top-0 z-20 -mx-4 -mt-4 md:-mx-7 md:-mt-5 bg-bg">
        <Topbar
          crumbs={[
            { label: 'Settings', href: '/settings' },
            { label: 'Pending Deletions' },
          ]}
        />
      </div>

      <div className="space-y-4 pt-4 md:pt-5">
        <div className="flex items-start gap-2.5 rounded-card border border-warn/25 bg-warn-bg px-5 py-3.5">
          <span className="mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full bg-warn" />
          <p className="text-[12.5px] leading-[1.5] text-text">
            Prompt version deletions appear here for 72 hours before becoming
            permanent. API keys and provider keys are deleted immediately and
            never appear in this queue.
          </p>
        </div>

        <div className="rounded-card border border-border bg-bg-elev shadow-card">
          <div className="overflow-x-auto">
            <div className="min-w-[720px]">
              <div className={cn(ROW_GRID, 'border-b border-border bg-bg-muted px-[18px] py-2.5')}>
                <span className="micro-label">Resource</span>
                <span className="micro-label">Kind</span>
                <span className="micro-label">Requested by</span>
                <span className="micro-label">Requested</span>
                <span className="micro-label">Deletes in</span>
                <span className="micro-label" />
              </div>

              {active.isLoading ? (
                <div className="px-[18px] py-8 text-[12.5px] text-text-muted">Loading…</div>
              ) : active.error ? (
                <div className="px-[18px] py-8 text-[12.5px] text-bad">Failed to load.</div>
              ) : !active.data || active.data.length === 0 ? (
                <div className="px-[18px] py-8 text-[12.5px] text-text-muted">
                  Nothing pending.
                </div>
              ) : (
                active.data.map((row) => {
                  const remaining = formatRemaining(row.scheduledFor)
                  return (
                    <div
                      key={row.id}
                      className={cn(ROW_GRID, 'border-b border-border px-[18px] py-3 last:border-b-0')}
                    >
                      <span className="truncate font-mono text-[12px] text-text">
                        {snapshotName(row)}
                      </span>
                      <span className="font-mono text-[12px] text-text-muted">
                        {RESOURCE_LABELS[row.resourceType]}
                      </span>
                      <span className="truncate font-mono text-[12px] text-text-muted">
                        {row.requestedBy ?? 'unknown'}
                      </span>
                      <span className="font-mono text-[12px] text-text-muted">
                        {formatAgo(row.requestedAt)}
                      </span>
                      <span className={cn('font-mono text-[12px]', TONE_CLASS[remaining.tone])}>
                        {remaining.text}
                      </span>
                      <span className="flex justify-end">
                        {canRestore && (
                          confirming === row.id ? (
                            <span className="flex gap-2">
                              <button
                                type="button"
                                disabled={restore.isPending}
                                onClick={() => {
                                  restore.mutate(row.id, {
                                    onSettled: () => setConfirming(null),
                                  })
                                }}
                                className="rounded-full bg-text px-3.5 py-2 text-[12px] font-medium text-bg hover:opacity-90 disabled:opacity-50"
                              >
                                Confirm
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirming(null)}
                                className="rounded-full border border-border bg-bg-elev px-3.5 py-2 text-[12px] font-medium text-text hover:bg-bg-muted"
                              >
                                Cancel
                              </button>
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirming(row.id)}
                              className="rounded-full border border-border bg-bg-elev px-3.5 py-2 text-[12px] font-medium text-text hover:bg-bg-muted"
                            >
                              Restore
                            </button>
                          )
                        )}
                      </span>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Recent history</CardTitle>
            <span className="font-mono text-[11px] text-text-faint">Last 50</span>
          </CardHeader>
          <CardContent>
            {history.isLoading ? (
              <div className="py-4 text-[12.5px] text-text-muted">Loading…</div>
            ) : !history.data || history.data.length === 0 ? (
              <div className="py-4 text-[12.5px] text-text-muted">No completed deletions yet.</div>
            ) : (
              <div>
                {history.data.map((row) => {
                  const status = row.executedAt
                    ? { label: 'Hard-deleted', tone: 'danger' as const }
                    : { label: 'Restored', tone: 'safe' as const }
                  const eventTime = row.executedAt ?? row.cancelledAt ?? row.requestedAt
                  return (
                    <div
                      key={row.id}
                      className="flex items-center justify-between gap-4 border-b border-border py-2.5 first:pt-0 last:border-b-0"
                    >
                      <span className="truncate font-mono text-[12px] text-text">
                        {RESOURCE_LABELS[row.resourceType]} · {snapshotName(row)}
                      </span>
                      <span className="shrink-0 text-[11.5px] text-text-faint">
                        <span className={TONE_CLASS[status.tone]}>{status.label}</span>
                        {' '}
                        {formatDate(eventTime)}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <p className="text-[11.5px] text-text-muted">
          Need to delete something permanently before 72 hours? Hard-delete is not exposed
          through the dashboard.{' '}
          <Link href="/settings" className="underline">
            Contact support
          </Link>{' '}
          and we&apos;ll expedite cleanup.
        </p>
      </div>
    </>
  )
}
