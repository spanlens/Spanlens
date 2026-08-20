'use client'

import { useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { cn, formatDateTime } from '@/lib/utils'
import { useHydrationSafeNow } from '@/lib/hydration-safe-now'
import { Topbar } from '@/components/layout/topbar'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  useAdminPatchFeedback,
  useFeedbackList,
  type FeedbackCategory,
  type FeedbackItem,
  type FeedbackStatus,
} from '@/lib/queries/use-feedback'

const STATUSES: FeedbackStatus[] = ['new', 'planned', 'in_progress', 'shipped', 'declined']

const STATUS_LABEL: Record<FeedbackStatus, string> = {
  new: 'New',
  planned: 'Planned',
  in_progress: 'In progress',
  shipped: 'Shipped',
  declined: 'Declined',
}

/** Pill recipe shared by the status and category chips. */
const PILL = 'inline-flex items-center rounded-full px-2 py-[3px] font-mono text-[10.5px]'

const STATUS_STYLE: Record<FeedbackStatus, string> = {
  new: 'bg-bg-chip text-text-muted',
  planned: 'bg-accent-bg text-accent',
  in_progress: 'bg-warn-bg text-warn',
  shipped: 'bg-good-bg text-good',
  declined: 'bg-bg-chip text-text-faint',
}

const CATEGORY_STYLE: Record<FeedbackCategory, string> = {
  bug: 'bg-accent-bg text-accent',
  feature: 'bg-bg-chip text-text-muted',
  other: 'bg-bg-chip text-text-faint',
}

const FIELD_LABEL = 'font-mono text-[10px] uppercase tracking-[0.1em] text-text-faint'
const FIELD_CONTROL =
  'w-full rounded-md border border-border bg-bg-elev px-3 py-2 text-[12.5px] text-text placeholder:text-text-faint focus:border-accent focus:outline-none'
const PILL_BTN_SECONDARY =
  'rounded-full border border-border bg-bg-elev px-3.5 py-2 text-[12px] font-medium text-text hover:bg-bg-muted'
const PILL_BTN_PRIMARY =
  'rounded-full bg-text px-3.5 py-2 text-[12px] font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-40'

/**
 * Submissions carry a single free-text field, so the inbox headline is the
 * first line of the message rather than a stored subject.
 */
function subjectOf(message: string): string {
  const firstLine = message.split('\n')[0]?.trim()
  return firstLine && firstLine.length > 0 ? firstLine : message.trim()
}

function formatElapsed(ms: number): string {
  const hours = ms / 3_600_000
  if (hours < 1) return `${Math.max(1, Math.round(ms / 60_000))}m`
  if (hours < 48) return `${Math.round(hours)}h`
  return `${Math.round(hours / 24)}d`
}

export function AdminFeedbackClient() {
  const [filter, setFilter] = useState<FeedbackStatus | 'all'>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const list = useFeedbackList(filter === 'all' ? undefined : filter)
  const rows = useMemo(() => list.data?.data ?? [], [list.data])
  const now = useHydrationSafeNow()

  // These counts describe the rows currently loaded. Under the default "All"
  // filter that is the whole queue; narrowing the filter narrows them too,
  // which is the reading the adjacent filter row sets up.
  const stats = useMemo(() => {
    const weekAgo = now - 7 * 86_400_000
    const responded = rows.filter((r) => r.responded_at !== null)
    const totalResponseMs = responded.reduce(
      (sum, r) =>
        sum + (new Date(r.responded_at as string).getTime() - new Date(r.created_at).getTime()),
      0,
    )
    return {
      newCount: rows.filter((r) => r.status === 'new').length,
      // `now` is 0 until the post-hydration commit, which would make every row
      // look older than a week. Hold the figure back until it is real.
      thisWeek:
        now === 0 ? null : rows.filter((r) => new Date(r.created_at).getTime() >= weekAgo).length,
      bugs: rows.filter((r) => r.category === 'bug').length,
      avgResponse: responded.length > 0 ? formatElapsed(totalResponseMs / responded.length) : null,
    }
  }, [rows, now])

  // Derived rather than stored so a filter change (or a row leaving the list
  // after a status edit) can never leave the detail pane pointing at nothing.
  const selected = rows.find((r) => r.id === selectedId) ?? rows[0] ?? null

  return (
    <>
      {/* The topbar is the only full-bleed row: it cancels the padding
          `DashboardContent` applies so its hairline spans the whole main
          column. Everything below sits flush inside that padding. */}
      <div className="sticky top-0 z-20 -mx-4 -mt-4 md:-mx-7 md:-mt-5 bg-bg">
        <Topbar crumbs={[{ label: 'Admin' }, { label: 'Feedback' }]} />
      </div>
      {/* The breadcrumb carries the page label on screen, so the document
          heading stays for assistive tech only rather than being repeated. */}
      <h1 className="sr-only">Feedback admin</h1>

      <div className="flex flex-col gap-4 pt-4 md:pt-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="New" value={String(stats.newCount)} />
          <StatCard
            label="This week"
            value={stats.thisWeek === null ? '—' : String(stats.thisWeek)}
          />
          <StatCard label="Bug reports" value={String(stats.bugs)} />
          <StatCard label="Avg response" value={stats.avgResponse ?? '—'} />
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-1.5">
            {(['all', ...STATUSES] as Array<FeedbackStatus | 'all'>).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                className={cn(
                  'rounded-full border px-3.5 py-2 text-[12px] font-medium transition-colors',
                  filter === value
                    ? 'border-accent-border bg-accent-bg text-accent'
                    : 'border-border bg-bg-elev text-text-muted hover:bg-bg-muted hover:text-text',
                )}
              >
                {value === 'all' ? 'All' : STATUS_LABEL[value]}
              </button>
            ))}
          </div>
          <p className="font-mono text-[11px] leading-relaxed text-text-faint">
            Move items through the lifecycle and post the public response shown on
            <code className="px-1">/feedback</code>. PATCH 403 means your email is not in
            <code className="px-1">SPANLENS_ADMIN_EMAILS</code>.
          </p>
        </div>

        {list.isLoading ? (
          <div className="flex items-center justify-center gap-2 py-8 font-mono text-[12px] text-text-faint">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading…
          </div>
        ) : list.isError ? (
          <Card>
            <CardContent className="pt-[18px] text-center font-mono text-[12px] text-bad">
              Could not load feedback. Refresh to try again.
            </CardContent>
          </Card>
        ) : rows.length === 0 ? (
          <Card>
            <CardContent className="pt-10 pb-10 text-center">
              <p className="font-mono text-[12px] text-text-faint">No items.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
            <Card className="self-start">
              <CardHeader>
                <CardTitle>Inbox</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col gap-1">
                  {rows.map((item) => {
                    const isSelected = selected?.id === item.id
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedId(item.id)}
                          aria-current={isSelected ? 'true' : undefined}
                          className={cn(
                            'flex w-full items-start justify-between gap-2 rounded-lg px-3 py-2.5 text-left transition-colors',
                            isSelected ? 'bg-bg-muted' : 'hover:bg-bg-muted',
                          )}
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-[12.5px] font-medium text-text">
                              {subjectOf(item.message)}
                            </span>
                            <span className="mt-1 block truncate font-mono text-[11.5px] text-text-faint">
                              {STATUS_LABEL[item.status]} · {item.vote_count} votes
                            </span>
                          </span>
                          <span className={cn(PILL, 'shrink-0', CATEGORY_STYLE[item.category])}>
                            {item.category}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </CardContent>
            </Card>

            {selected && <FeedbackDetail key={selected.id} item={selected} />}
          </div>
        )}
      </div>
    </>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card border border-border bg-bg-elev px-5 py-[18px] shadow-card">
      <div className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-text-faint">
        {label}
      </div>
      <div className="mt-[7px] font-display text-[22px] leading-[1.05] track-h3 text-text">
        {value}
      </div>
    </div>
  )
}

interface FeedbackDetailProps {
  item: FeedbackItem
}

/**
 * Detail pane. Keyed by item id upstream so the draft fields reset when the
 * inbox selection moves rather than carrying one row's edits onto another.
 */
function FeedbackDetail({ item }: FeedbackDetailProps) {
  const patch = useAdminPatchFeedback()
  const [editing, setEditing] = useState(false)
  const [status, setStatus] = useState<FeedbackStatus>(item.status)
  const [response, setResponse] = useState(item.response_message ?? '')
  const [changelogUrl, setChangelogUrl] = useState(item.changelog_url ?? '')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  function handleSave() {
    setErrorMessage(null)
    const trimmedResponse = response.trim()
    const trimmedChangelog = changelogUrl.trim()
    patch.mutate(
      {
        id: item.id,
        status,
        response_message: trimmedResponse.length > 0 ? trimmedResponse : null,
        changelog_url: trimmedChangelog.length > 0 ? trimmedChangelog : null,
      },
      {
        onSuccess: () => {
          setEditing(false)
        },
        onError: (err) => {
          const msg = err instanceof Error ? err.message : 'Failed to save'
          setErrorMessage(msg)
        },
      },
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-[15px]">{subjectOf(item.message)}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* Meta strip. The API returns no submitter identity, so nothing here
            can leak one — the columns are the fields the row actually has. */}
        <div className="flex flex-wrap gap-x-8 gap-y-3">
          <MetaField label="status" value={STATUS_LABEL[item.status]} />
          <MetaField label="category" value={item.category} />
          <MetaField label="votes" value={String(item.vote_count)} />
          <MetaField label="sent" value={formatDateTime(item.created_at)} />
        </div>

        <div className="rounded-lg bg-bg-sunk px-4 py-3.5">
          <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-text">
            {item.message}
          </p>
        </div>

        {/* Existing response (read view) */}
        {!editing && item.response_message && (
          <div className="border-l-2 border-accent pl-3">
            <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.1em] text-accent">
              Public response
            </p>
            <p className="whitespace-pre-wrap text-[11.5px] leading-relaxed text-text-muted">
              {item.response_message}
            </p>
            {item.changelog_url && (
              <p className="mt-1 font-mono text-[11px] text-accent">{item.changelog_url}</p>
            )}
          </div>
        )}

        {/* Edit panel */}
        {editing ? (
          <div className="flex flex-col gap-3 rounded-lg bg-bg-sunk px-4 py-3.5">
            <div className="flex flex-col gap-1.5">
              <label className={FIELD_LABEL}>Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as FeedbackStatus)}
                className={cn(FIELD_CONTROL, 'font-medium')}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className={FIELD_LABEL}>Public response (optional)</label>
              <textarea
                value={response}
                onChange={(e) => setResponse(e.target.value)}
                rows={3}
                placeholder="Shown under the submission on /feedback. Leave empty to clear."
                className={cn(FIELD_CONTROL, 'resize-y leading-relaxed')}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className={FIELD_LABEL}>Changelog URL (optional)</label>
              <input
                type="url"
                value={changelogUrl}
                onChange={(e) => setChangelogUrl(e.target.value)}
                placeholder="https://www.spanlens.io/changelog#…"
                className={FIELD_CONTROL}
              />
            </div>
            {errorMessage && <p className="font-mono text-[11px] text-bad">{errorMessage}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleSave}
                disabled={patch.isPending}
                className={PILL_BTN_PRIMARY}
              >
                {patch.isPending ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(false)
                  setStatus(item.status)
                  setResponse(item.response_message ?? '')
                  setChangelogUrl(item.changelog_url ?? '')
                  setErrorMessage(null)
                }}
                className={PILL_BTN_SECONDARY}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setEditing(true)} className={PILL_BTN_PRIMARY}>
              Edit
            </button>
            <span className={cn(PILL, STATUS_STYLE[item.status])}>{STATUS_LABEL[item.status]}</span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function MetaField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className={FIELD_LABEL}>{label}</div>
      <div className="mt-1 font-mono text-[12px] text-text">{value}</div>
    </div>
  )
}
