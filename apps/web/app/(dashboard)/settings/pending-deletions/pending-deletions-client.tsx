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
import { cn } from '@/lib/utils'

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

const TONE_CLASS = {
  safe: 'text-emerald-600 dark:text-emerald-400',
  warn: 'text-amber-600 dark:text-amber-400',
  danger: 'text-red-600 dark:text-red-400',
  expired: 'text-zinc-400',
}

export function PendingDeletionsClient() {
  const role = useCurrentRole()
  const canRestore = role === 'admin' || role === 'editor'
  const active = usePendingDeletions()
  const history = usePendingDeletionsHistory()
  const restore = useRestorePendingDeletion()
  const [confirming, setConfirming] = useState<string | null>(null)

  return (
    <div className="flex flex-col gap-6">
      <Topbar
        crumbs={[
          { label: 'Settings', href: '/settings' },
          { label: 'Pending Deletions' },
        ]}
      />

      <section className="rounded-lg border border-[var(--border-strong)] bg-[var(--bg)]">
        <header className="border-b border-[var(--border-strong)] px-5 py-3">
          <h2 className="text-sm font-medium">Active queue</h2>
        </header>

        {active.isLoading ? (
          <div className="px-5 py-8 text-sm text-[var(--text-muted)]">Loading…</div>
        ) : active.error ? (
          <div className="px-5 py-8 text-sm text-red-600">Failed to load.</div>
        ) : !active.data || active.data.length === 0 ? (
          <div className="px-5 py-8 text-sm text-[var(--text-muted)]">
            Nothing pending. Deletions appear here for 72 hours before becoming permanent.
          </div>
        ) : (
          <ul className="divide-y divide-[var(--border-strong)]">
            {active.data.map((row) => {
              const remaining = formatRemaining(row.scheduledFor)
              return (
                <li key={row.id} className="grid grid-cols-12 items-center gap-3 px-5 py-3">
                  <div className="col-span-3 text-xs text-[var(--text-muted)]">
                    {RESOURCE_LABELS[row.resourceType]}
                  </div>
                  <div className="col-span-4 text-sm font-medium truncate">
                    {snapshotName(row)}
                  </div>
                  <div className={cn('col-span-3 text-xs', TONE_CLASS[remaining.tone])}>
                    {remaining.text}
                  </div>
                  <div className="col-span-2 flex justify-end">
                    {canRestore && (
                      confirming === row.id ? (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={restore.isPending}
                            onClick={() => {
                              restore.mutate(row.id, {
                                onSettled: () => setConfirming(null),
                              })
                            }}
                            className="rounded-chip border border-emerald-600 px-2 py-1 text-xs text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950"
                          >
                            Confirm
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirming(null)}
                            className="rounded-chip border border-[var(--border-strong)] px-2 py-1 text-xs"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirming(row.id)}
                          className="rounded-chip border border-[var(--border-strong)] px-3 py-1 text-xs hover:bg-[var(--bg-hover)]"
                        >
                          Restore
                        </button>
                      )
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-[var(--border-strong)] bg-[var(--bg)]">
        <header className="border-b border-[var(--border-strong)] px-5 py-3 flex items-center justify-between">
          <h2 className="text-sm font-medium">Recent history</h2>
          <span className="text-xs text-[var(--text-muted)]">Last 50</span>
        </header>

        {history.isLoading ? (
          <div className="px-5 py-8 text-sm text-[var(--text-muted)]">Loading…</div>
        ) : !history.data || history.data.length === 0 ? (
          <div className="px-5 py-8 text-sm text-[var(--text-muted)]">No completed deletions yet.</div>
        ) : (
          <ul className="divide-y divide-[var(--border-strong)]">
            {history.data.map((row) => {
              const status = row.executedAt
                ? { label: 'Hard-deleted', tone: 'danger' as const }
                : { label: 'Restored', tone: 'safe' as const }
              const eventTime = row.executedAt ?? row.cancelledAt ?? row.requestedAt
              return (
                <li key={row.id} className="grid grid-cols-12 items-center gap-3 px-5 py-3">
                  <div className="col-span-3 text-xs text-[var(--text-muted)]">
                    {RESOURCE_LABELS[row.resourceType]}
                  </div>
                  <div className="col-span-4 text-sm truncate">
                    {snapshotName(row)}
                  </div>
                  <div className={cn('col-span-3 text-xs', TONE_CLASS[status.tone])}>
                    {status.label}
                  </div>
                  <div className="col-span-2 text-right text-xs text-[var(--text-muted)]">
                    {new Date(eventTime).toLocaleDateString('en-US', {
                      month: 'short', day: 'numeric',
                    })}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <p className="text-xs text-[var(--text-muted)]">
        Need to delete something permanently before 72 hours? Hard-delete is not exposed
        through the dashboard.{' '}
        <Link href="/settings" className="underline">
          Contact support
        </Link>{' '}
        and we&apos;ll expedite cleanup.
      </p>
    </div>
  )
}
