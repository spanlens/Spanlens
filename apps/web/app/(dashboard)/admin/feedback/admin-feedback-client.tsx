'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatDateTime } from '@/lib/utils'
import { Topbar } from '@/components/layout/topbar'
import {
  useAdminPatchFeedback,
  useFeedbackList,
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

const STATUS_STYLE: Record<FeedbackStatus, string> = {
  new: 'bg-bg-elev text-text-muted border-border',
  planned: 'bg-accent-bg text-accent border-accent/30',
  in_progress: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/30',
  shipped: 'bg-good/10 text-good border-good/30',
  declined: 'bg-bg-elev text-text-faint border-border',
}

export function AdminFeedbackClient() {
  const [filter, setFilter] = useState<FeedbackStatus | 'all'>('all')
  const list = useFeedbackList(filter === 'all' ? undefined : filter)

  return (
    <div className="-mx-4 -my-4 md:-mx-8 md:-my-7 flex flex-col min-h-screen">
      <div className="sticky top-0 z-20 bg-bg">
        <Topbar crumbs={[{ label: 'Admin' }, { label: 'Feedback' }]} />
      </div>
      <div className="px-[22px] py-[22px] flex flex-col gap-5 max-w-4xl w-full">
        <div>
          <h1 className="font-medium text-[20px] tracking-[-0.3px] text-text">Feedback admin</h1>
          <p className="font-mono text-[11.5px] text-text-faint mt-1.5">
            Move items through the lifecycle and post the public response shown on
            <code className="px-1">/feedback</code>. PATCH 403 means your email is not in
            <code className="px-1">SPANLENS_ADMIN_EMAILS</code>.
          </p>
        </div>

        <div className="flex gap-1.5 flex-wrap">
          {(['all', ...STATUSES] as Array<FeedbackStatus | 'all'>).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={cn(
                'px-3 py-1.5 rounded-[6px] border font-mono text-[11.5px] transition-colors',
                filter === value
                  ? 'border-accent text-accent bg-accent-bg'
                  : 'border-border text-text-muted hover:text-text hover:border-border-strong',
              )}
            >
              {value === 'all' ? 'All' : STATUS_LABEL[value]}
            </button>
          ))}
        </div>

        {list.isLoading ? (
          <div className="flex items-center gap-2 text-text-faint font-mono text-[12px] py-8 justify-center">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading…
          </div>
        ) : list.isError ? (
          <div className="border border-border rounded-[8px] p-6 text-center font-mono text-[12px] text-bad">
            Could not load feedback. Refresh to try again.
          </div>
        ) : (list.data?.data ?? []).length === 0 ? (
          <div className="border border-border rounded-[8px] p-10 text-center">
            <p className="font-mono text-[12px] text-text-faint">No items.</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {(list.data?.data ?? []).map((item) => (
              <AdminRow key={item.id} item={item} />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

interface AdminRowProps {
  item: FeedbackItem
}

function AdminRow({ item }: AdminRowProps) {
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
    <li className="border border-border rounded-[8px] p-4 bg-bg flex flex-col gap-3">
      {/* Meta */}
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
            STATUS_STYLE[item.status],
          )}
        >
          {STATUS_LABEL[item.status]}
        </span>
        <span className="font-mono text-[10.5px] text-text-faint">
          {item.category} · {item.vote_count} votes
        </span>
        <time
          dateTime={item.created_at}
          className="font-mono text-[10.5px] text-text-faint ml-auto"
        >
          {formatDateTime(item.created_at)}
        </time>
      </div>

      {/* Message */}
      <p className="font-mono text-[12.5px] text-text whitespace-pre-wrap leading-relaxed">
        {item.message}
      </p>

      {/* Existing response (read view) */}
      {!editing && item.response_message && (
        <div className="border-l-2 border-accent pl-3">
          <p className="font-mono text-[10px] uppercase tracking-wide text-accent mb-1">
            Public response
          </p>
          <p className="font-mono text-[11.5px] text-text-muted whitespace-pre-wrap leading-relaxed">
            {item.response_message}
          </p>
          {item.changelog_url && (
            <p className="font-mono text-[10.5px] text-accent mt-1">{item.changelog_url}</p>
          )}
        </div>
      )}

      {/* Edit panel */}
      {editing ? (
        <div className="flex flex-col gap-3 border border-border rounded-[6px] p-3 bg-bg-elev">
          <div className="flex flex-col gap-1.5">
            <label className="font-mono text-[10px] uppercase tracking-wide text-text-faint">
              Status
            </label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as FeedbackStatus)}
              className="rounded-[6px] border border-border bg-bg px-2.5 py-1.5 font-mono text-[12px] text-text"
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="font-mono text-[10px] uppercase tracking-wide text-text-faint">
              Public response (optional)
            </label>
            <textarea
              value={response}
              onChange={(e) => setResponse(e.target.value)}
              rows={3}
              placeholder="Shown under the submission on /feedback. Leave empty to clear."
              className="w-full resize-y rounded-[6px] border border-border bg-bg px-2.5 py-2 font-mono text-[12px] text-text placeholder:text-text-faint focus:outline-none focus:border-accent"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="font-mono text-[10px] uppercase tracking-wide text-text-faint">
              Changelog URL (optional)
            </label>
            <input
              type="url"
              value={changelogUrl}
              onChange={(e) => setChangelogUrl(e.target.value)}
              placeholder="https://www.spanlens.io/changelog#…"
              className="w-full rounded-[6px] border border-border bg-bg px-2.5 py-1.5 font-mono text-[12px] text-text placeholder:text-text-faint focus:outline-none focus:border-accent"
            />
          </div>
          {errorMessage && (
            <p className="font-mono text-[11px] text-bad">{errorMessage}</p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={patch.isPending}
              className="font-mono text-[11.5px] px-3 py-1.5 rounded-[6px] bg-text text-bg hover:opacity-90 disabled:opacity-40"
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
              className="font-mono text-[11.5px] px-3 py-1.5 rounded-[6px] border border-border text-text-muted hover:text-text"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="self-start font-mono text-[11px] px-3 py-1.5 rounded-[6px] border border-border text-text-muted hover:text-text hover:border-border-strong"
        >
          Edit
        </button>
      )}
    </li>
  )
}
