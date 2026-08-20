'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { Topbar } from '@/components/layout/topbar'
import { cn, formatDate } from '@/lib/utils'
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

// ── Shared surface classes ───────────────────────────────────────────────────
// The head and row grids must stay in lockstep, so the column template lives
// in one place rather than being repeated at each call site.
const TABLE_CARD = 'rounded-card border border-border bg-bg-elev shadow-card overflow-hidden'
const TABLE_HEAD_CELL = 'font-mono text-[10px] uppercase tracking-[0.1em] text-text-faint'
const PILL_SECONDARY =
  'rounded-full border border-border bg-bg-elev px-3.5 py-2 text-[12px] font-medium text-text hover:bg-bg-muted transition-colors disabled:opacity-50'
const STATUS_PILL =
  'inline-flex w-fit items-center rounded-full px-2 py-[3px] font-mono text-[10.5px]'
const SHARE_COLS =
  'grid grid-cols-[minmax(180px,1fr)_minmax(200px,1.4fr)_80px_minmax(190px,1.2fr)_130px_110px_120px] gap-3'

export function SharesClient() {
  const [scope, setScope] = useState<ShareScopeFilter>('org')
  const [sort, setSort] = useState<ShareSort>('created')
  const { data, isLoading, error } = useShares({ scope, sort })

  return (
    <>
      {/* The topbar is the only full-bleed row: it cancels the padding
          `DashboardContent` applies so its hairline spans the whole main
          column. Everything below sits flush inside that padding. */}
      <div className="sticky top-0 z-20 -mx-4 -mt-4 md:-mx-7 md:-mt-5 bg-bg">
        <Topbar crumbs={[{ label: 'Shared links' }]} />
      </div>

      <div className="pt-4 md:pt-5 space-y-4">
        {/* The breadcrumb carries the visible page title, so the document
            heading is screen-reader only. */}
        <h1 className="sr-only">Shared links</h1>

        {/* Filter bar. The Figma board folds sort and author into a single
            segmented control; kept as two controls here because they are
            independent axes and merging them would drop combinations. */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[12px] text-text-muted max-w-2xl">
            Public{' '}
            <code className="font-mono text-[11px] px-1 py-0.5 rounded bg-bg-sunk border border-border">
              /share/&lt;token&gt;
            </code>{' '}
            links published from this workspace. Anyone with the URL can read
            the redacted view. Revoke immediately if a link leaks.
          </p>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <SegmentedControl
              ariaLabel="Filter by author"
              options={SCOPE_OPTIONS}
              value={scope}
              onChange={setScope}
            />
            <SegmentedControl
              ariaLabel="Sort shares"
              options={SORT_OPTIONS}
              value={sort}
              onChange={setSort}
            />
          </div>
        </div>

        <StatRow rows={data} />

        {error ? <ErrorBox message={(error as Error).message} /> : null}
        {isLoading ? <LoadingTable /> : null}
        {data ? <ShareTable rows={data} /> : null}
      </div>
    </>
  )
}

/**
 * Four-up overview of the current result set. Derived from the rows already on
 * screen — no extra round trip — so the figures follow the active scope filter.
 */
function StatRow({ rows }: { rows: ShareRow[] | undefined }) {
  const cards = useMemo(() => {
    const list = rows ?? []
    const total = list.length
    const views = list.reduce((sum, r) => sum + r.view_count, 0)
    const piiRedacted = list.filter((r) => r.redact_pii).length
    const costHidden = list.filter((r) => r.redact_cost).length
    const expiringSoon = list.filter((r) => isExpiringSoon(r.expires_at)).length
    const allPii = total > 0 && piiRedacted === total
    return [
      {
        label: 'Active shares',
        value: String(total),
        note: expiringSoon > 0 ? `${expiringSoon} expiring within 7 days` : 'none expiring this week',
        tone: expiringSoon > 0 ? 'text-warn' : 'text-text-faint',
      },
      {
        label: 'Total views',
        value: views.toLocaleString('en-US'),
        note: 'across all shares',
        tone: 'text-text-faint',
      },
      {
        label: 'PII redacted',
        value: `${piiRedacted} of ${total}`,
        note: allPii ? 'enforced on every share' : 'per share setting',
        tone: allPii ? 'text-good' : 'text-text-faint',
      },
      {
        label: 'Cost hidden',
        value: `${costHidden} of ${total}`,
        note: 'per share setting',
        tone: 'text-text-faint',
      },
    ]
  }, [rows])

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {cards.map((c) => (
        <div
          key={c.label}
          className="rounded-card border border-border bg-bg-elev shadow-card px-5 py-[18px]"
        >
          <div className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-text-faint">
            {c.label}
          </div>
          <div className="font-display text-[22px] track-h3 leading-[1.05] text-text mt-[7px] tabular-nums">
            {c.value}
          </div>
          <div className={cn('text-[11.5px] font-medium mt-[7px] truncate', c.tone)}>{c.note}</div>
        </div>
      ))}
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
      className="inline-flex items-center gap-0.5 rounded-full bg-bg-chip p-[3px]"
    >
      {options.map((opt) => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              'rounded-full px-[11px] py-[5px] text-[12px] font-medium transition-colors whitespace-nowrap',
              active ? 'bg-bg-elev text-text shadow-card' : 'text-text-faint hover:text-text',
            )}
            aria-pressed={active}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

function ShareTable({ rows }: { rows: ShareRow[] }) {
  if (rows.length === 0) {
    return (
      <div className={cn(TABLE_CARD, 'px-6 py-10 text-center text-[12.5px] text-text-muted')}>
        No shares yet. Open a trace or request and click <strong>Share</strong> to publish one.
      </div>
    )
  }

  return (
    <div className={TABLE_CARD}>
      {/* Wide table scrolls inside its own container so the page body never
          scrolls horizontally. */}
      <div className="overflow-x-auto">
        <div className="min-w-[1120px]">
          <div className={cn(SHARE_COLS, 'bg-bg-muted border-b border-border px-[18px] py-2.5')}>
            <span className={TABLE_HEAD_CELL}>Share</span>
            <span className={TABLE_HEAD_CELL}>Target</span>
            <span className={TABLE_HEAD_CELL}>Views</span>
            <span className={TABLE_HEAD_CELL}>Redaction</span>
            <span className={TABLE_HEAD_CELL}>Created</span>
            <span className={TABLE_HEAD_CELL}>Expires</span>
            <span className={cn(TABLE_HEAD_CELL, 'text-right')}>Actions</span>
          </div>
          {rows.map((row) => (
            <ShareTableRow key={row.id} row={row} />
          ))}
        </div>
      </div>
    </div>
  )
}

function ShareTableRow({ row }: { row: ShareRow }) {
  const revoke = useRevokeShare()
  const expiresLabel = useMemo(() => formatExpiry(row.expires_at), [row.expires_at])
  const expiresSoon = useMemo(() => isExpiringSoon(row.expires_at), [row.expires_at])
  const shareUrl = `/share/${row.token}`

  return (
    <div className={cn(SHARE_COLS, 'items-center px-[18px] py-3 border-b border-border last:border-b-0')}>
      {/* The token stays out of the visible cell — it only ever lives in the
          link href, exactly as before. */}
      <span className="font-mono text-[12px] text-text truncate">
        {row.scope} · {row.target_id.slice(0, 8)}…
      </span>
      <span className="min-w-0 truncate" title={row.target_label}>
        <Link
          href={shareUrl}
          className="font-mono text-[12px] text-accent hover:underline"
          target="_blank"
          rel="noopener noreferrer"
        >
          {row.target_label}
        </Link>
      </span>
      <span className="font-mono text-[12px] text-text-muted tabular-nums">
        {row.view_count.toLocaleString('en-US')}
      </span>
      <span className="min-w-0">
        <RedactionChips row={row} />
      </span>
      <span className="font-mono text-[12px] text-text-muted whitespace-nowrap">
        {formatDate(row.created_at)}
      </span>
      <span
        className={cn(
          'font-mono text-[12px] whitespace-nowrap',
          expiresSoon ? 'text-warn' : 'text-text-muted',
        )}
      >
        {expiresLabel}
      </span>
      <span className="flex justify-end">
        <button
          type="button"
          disabled={revoke.isPending}
          onClick={() => {
            const ok = window.confirm(
              `Revoke this share?\n\nThe public URL will start returning 404 immediately. This cannot be undone.`,
            )
            if (ok) revoke.mutate(row.token)
          }}
          className={cn(
            PILL_SECONDARY,
            'hover:border-accent-border hover:bg-accent-bg hover:text-accent',
          )}
        >
          {revoke.isPending ? 'Revoking…' : 'Revoke'}
        </button>
      </span>
    </div>
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
          className={cn(STATUS_PILL, item.on ? 'bg-good-bg text-good' : 'bg-bg-chip text-text-muted')}
          title={item.on ? `${item.label} hidden` : `${item.label} visible`}
        >
          {item.on ? `${item.label} ✓` : `${item.label} ✗`}
        </span>
      ))}
      {row.indexable ? (
        <span className={cn(STATUS_PILL, 'bg-warn-bg text-warn')}>indexable</span>
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
    <div className={cn(TABLE_CARD, 'p-5 space-y-3')}>
      {[1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          className="h-9 rounded-md bg-bg-muted animate-pulse"
          style={{ opacity: 1 - i * 0.12 }}
        />
      ))}
    </div>
  )
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="rounded-card border border-bad/30 bg-bad-bg px-5 py-4 font-mono text-[11.5px] text-bad">
      Failed to load shared links: {message}
    </div>
  )
}
