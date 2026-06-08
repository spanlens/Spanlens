'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { Topbar } from '@/components/layout/topbar'
import { formatDateTime } from '@/lib/utils'
import {
  useRevokeShare,
  useShares,
  type ShareRow,
  type ShareScopeFilter,
  type ShareSort,
} from '@/lib/queries/use-shares'

/**
 * R-26 + R-33 Sprint 6 — workspace dashboard for public share links.
 *
 * Lists every active share in the workspace (scope=org by default — matches
 * the DELETE policy where any org member can revoke a teammate's leaked
 * share). Provides:
 *
 *   - Sort: newest / most-viewed / expiring-soonest
 *   - Filter: mine vs org
 *   - Per-row redaction summary chips
 *   - "Expires soon" warning (< 7d)
 *   - Revoke button with confirm-then-mutate (no separate confirm modal —
 *     keeps the dashboard one-screen for the launch volume)
 *
 * Does not implement create-from-here UX. The existing share-dialog
 * component (component/share/share-dialog.tsx) opens from the trace /
 * request detail pages and stays the canonical creation surface.
 */
const SORT_OPTIONS: { value: ShareSort; label: string }[] = [
  { value: 'created', label: 'Newest' },
  { value: 'views', label: 'Most viewed' },
  { value: 'expires_soon', label: 'Expiring soonest' },
]

const SCOPE_OPTIONS: { value: ShareScopeFilter; label: string }[] = [
  { value: 'org', label: 'Workspace' },
  { value: 'mine', label: 'My shares' },
]

export function SharesClient() {
  const [scope, setScope] = useState<ShareScopeFilter>('org')
  const [sort, setSort] = useState<ShareSort>('created')
  const { data, isLoading, error } = useShares({ scope, sort })

  return (
    <div>
      <Topbar crumbs={[{ label: 'Shared links' }]} />
      <main className="max-w-6xl mx-auto px-6 py-8 space-y-5">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-[18px] font-semibold tracking-tight">Shared links</h1>
            <p className="text-[12px] text-text-muted mt-1">
              Public {' '}
              <code className="font-mono text-[11px] px-1 py-0.5 rounded bg-bg-elevated">
                /share/&lt;token&gt;
              </code>{' '}
              links published from this workspace. Anyone with the URL can read
              the redacted view. Revoke immediately if a link leaks.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <SegmentedControl
              ariaLabel="Filter by author"
              options={SCOPE_OPTIONS}
              value={scope}
              onChange={setScope}
            />
            <SortPicker value={sort} onChange={setSort} />
          </div>
        </header>

        {error ? <ErrorBox message={(error as Error).message} /> : null}
        {isLoading ? <LoadingTable /> : null}
        {data ? <ShareTable rows={data} /> : null}
      </main>
    </div>
  )
}

function SegmentedControl<T extends string>({
  ariaLabel,
  options,
  value,
  onChange,
}: {
  ariaLabel: string
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex rounded-md border border-border overflow-hidden text-[11px] font-mono"
    >
      {options.map((opt) => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={
              'px-2.5 py-1 transition-colors ' +
              (active ? 'bg-accent/15 text-accent' : 'hover:bg-bg-elevated')
            }
            aria-pressed={active}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

function SortPicker({
  value,
  onChange,
}: {
  value: ShareSort
  onChange: (s: ShareSort) => void
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as ShareSort)}
      className="text-[11px] font-mono border border-border rounded-md px-2 py-1 bg-bg hover:bg-bg-elevated"
      aria-label="Sort shares"
    >
      {SORT_OPTIONS.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  )
}

function ShareTable({ rows }: { rows: ShareRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="border border-border rounded-md p-8 text-center text-[12px] text-text-muted">
        No shares yet. Open a trace or request and click <strong>Share</strong> to publish one.
      </div>
    )
  }

  return (
    <div className="border border-border rounded-md overflow-hidden">
      <table className="w-full text-[12px]">
        <thead className="bg-bg-elevated">
          <tr className="text-left text-[10px] uppercase tracking-wider text-text-muted">
            <th className="px-4 py-2 font-medium">Target</th>
            <th className="px-4 py-2 font-medium">Redaction</th>
            <th className="px-4 py-2 font-medium">Views</th>
            <th className="px-4 py-2 font-medium">Created</th>
            <th className="px-4 py-2 font-medium">Expires</th>
            <th className="px-4 py-2 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <ShareTableRow key={row.id} row={row} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ShareTableRow({ row }: { row: ShareRow }) {
  const revoke = useRevokeShare()
  const expiresLabel = useMemo(() => formatExpiry(row.expires_at), [row.expires_at])
  const expiresSoon = useMemo(() => isExpiringSoon(row.expires_at), [row.expires_at])
  const shareUrl = `/share/${row.token}`

  return (
    <tr className="border-t border-border hover:bg-bg-elevated/40">
      <td className="px-4 py-3">
        <div className="font-medium truncate max-w-[280px]" title={row.target_label}>
          <Link href={shareUrl} className="text-accent hover:underline" target="_blank" rel="noopener noreferrer">
            {row.target_label}
          </Link>
        </div>
        <div className="font-mono text-[10.5px] text-text-muted mt-0.5">
          {row.scope} · {row.target_id.slice(0, 8)}…
        </div>
      </td>
      <td className="px-4 py-3">
        <RedactionChips row={row} />
      </td>
      <td className="px-4 py-3 font-mono">{row.view_count.toLocaleString('en-US')}</td>
      <td className="px-4 py-3 font-mono text-[11px] text-text-muted whitespace-nowrap">
        {formatDateTime(row.created_at)}
      </td>
      <td className="px-4 py-3 font-mono text-[11px] whitespace-nowrap">
        <span className={expiresSoon ? 'text-status-warning' : 'text-text-muted'}>
          {expiresLabel}
        </span>
      </td>
      <td className="px-4 py-3 text-right">
        <button
          type="button"
          disabled={revoke.isPending}
          onClick={() => {
            const ok = window.confirm(
              `Revoke this share?\n\nThe public URL will start returning 404 immediately. This cannot be undone.`,
            )
            if (ok) revoke.mutate(row.token)
          }}
          className="text-[11px] font-mono px-2 py-1 rounded border border-border hover:bg-status-error/10 hover:text-status-error hover:border-status-error/40 transition-colors disabled:opacity-50"
        >
          {revoke.isPending ? 'Revoking…' : 'Revoke'}
        </button>
      </td>
    </tr>
  )
}

function RedactionChips({ row }: { row: ShareRow }) {
  const items: { label: string; on: boolean }[] = [
    { label: 'PII', on: row.redact_pii },
    { label: 'Cost', on: row.redact_cost },
    { label: 'Tokens', on: row.redact_tokens },
  ]
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((item) => (
        <span
          key={item.label}
          className={
            'inline-flex items-center px-1.5 py-0.5 rounded font-mono text-[10px] ' +
            (item.on
              ? 'bg-accent/10 text-accent border border-accent/20'
              : 'bg-bg-elevated text-text-muted border border-border')
          }
          title={item.on ? `${item.label} hidden` : `${item.label} visible`}
        >
          {item.on ? `${item.label} ✓` : `${item.label} ✗`}
        </span>
      ))}
      {row.indexable ? (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded font-mono text-[10px] bg-status-warning/10 text-status-warning border border-status-warning/30">
          indexable
        </span>
      ) : null}
    </div>
  )
}

function formatExpiry(expiresAt: string | null): string {
  if (!expiresAt) return 'Never'
  const expiry = new Date(expiresAt).getTime()
  const diffMs = expiry - Date.now()
  if (diffMs <= 0) return 'Expired'
  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000))
  if (days >= 30) return `${Math.floor(days / 30)}mo`
  if (days >= 1) return `${days}d`
  const hours = Math.floor(diffMs / (60 * 60 * 1000))
  return `${hours}h`
}

function isExpiringSoon(expiresAt: string | null): boolean {
  if (!expiresAt) return false
  const diffMs = new Date(expiresAt).getTime() - Date.now()
  // Warn when < 7 days. Already-expired rows also count so they stay visible.
  return diffMs < 7 * 24 * 60 * 60 * 1000
}

function LoadingTable() {
  return (
    <div className="border border-border rounded-md p-8 text-center text-[12px] text-text-muted animate-pulse">
      Loading shared links…
    </div>
  )
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="border border-status-error/40 bg-status-error/5 rounded-md p-4 font-mono text-[11.5px] text-status-error">
      Failed to load shared links: {message}
    </div>
  )
}
