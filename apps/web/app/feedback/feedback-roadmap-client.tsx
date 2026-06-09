'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowUp, Bug, Check, Lightbulb, Loader2, MessageSquarePlus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatDate } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import {
  useFeedbackList,
  useSubmitFeedback,
  useUnvoteFeedback,
  useUpvoteFeedback,
  type FeedbackCategory,
  type FeedbackItem,
  type FeedbackStatus,
} from '@/lib/queries/use-feedback'

const STATUS_FILTERS: Array<{ value: FeedbackStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'new', label: 'New' },
  { value: 'planned', label: 'Planned' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'shipped', label: 'Shipped' },
  { value: 'declined', label: 'Declined' },
]

const STATUS_STYLE: Record<FeedbackStatus, string> = {
  new: 'bg-bg-elev text-text-muted border-border',
  planned: 'bg-accent-bg text-accent border-accent/30',
  in_progress: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/30',
  shipped: 'bg-good/10 text-good border-good/30',
  declined: 'bg-bg-elev text-text-faint border-border',
}

const STATUS_LABEL: Record<FeedbackStatus, string> = {
  new: 'New',
  planned: 'Planned',
  in_progress: 'In progress',
  shipped: 'Shipped',
  declined: 'Declined',
}

const CATEGORY_LABEL: Record<FeedbackCategory, string> = {
  feature: 'Feature',
  bug: 'Bug',
  other: 'Other',
}

const CATEGORIES: Array<{ value: FeedbackCategory; label: string; icon: typeof Lightbulb }> = [
  { value: 'feature', label: 'Feature idea', icon: Lightbulb },
  { value: 'bug', label: 'Bug report', icon: Bug },
  { value: 'other', label: 'Other', icon: MessageSquarePlus },
]

const MAX_LEN = 4000

/**
 * Tracks the current user's auth state by polling Supabase's session once on
 * mount and listening for onAuthStateChange. We do not need a real user
 * object — the only branch is "show vote button vs sign-in CTA".
 */
function useIsAuthenticated(): { isAuthed: boolean; isLoading: boolean } {
  const [state, setState] = useState<{ isAuthed: boolean; isLoading: boolean }>({
    isAuthed: false,
    isLoading: true,
  })

  useEffect(() => {
    let cancelled = false
    const supabase = createClient()
    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return
      setState({ isAuthed: Boolean(data.session), isLoading: false })
    })
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setState({ isAuthed: Boolean(session), isLoading: false })
    })
    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [])

  return state
}

export function FeedbackRoadmapClient() {
  const [filter, setFilter] = useState<FeedbackStatus | 'all'>('all')
  const [showSubmit, setShowSubmit] = useState(false)

  const { isAuthed, isLoading: authLoading } = useIsAuthenticated()
  const list = useFeedbackList(filter === 'all' ? undefined : filter)
  const upvote = useUpvoteFeedback()
  const unvote = useUnvoteFeedback()

  return (
    <div className="flex flex-col gap-6">
      {/* Filter + Suggest */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-1.5 flex-wrap">
          {STATUS_FILTERS.map(({ value, label }) => (
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
              {label}
            </button>
          ))}
        </div>
        {isAuthed ? (
          <button
            type="button"
            onClick={() => setShowSubmit((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[6px] bg-text text-bg font-mono text-[12px] hover:opacity-90"
          >
            <MessageSquarePlus className="h-3.5 w-3.5" />
            {showSubmit ? 'Close' : 'Suggest a feature'}
          </button>
        ) : (
          <Link
            href={`/login?next=${encodeURIComponent('/feedback')}`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[6px] bg-text text-bg font-mono text-[12px] hover:opacity-90"
          >
            <MessageSquarePlus className="h-3.5 w-3.5" />
            Sign in to suggest
          </Link>
        )}
      </div>

      {showSubmit && isAuthed && <SubmitPanel onClose={() => setShowSubmit(false)} />}

      {/* List */}
      {list.isLoading ? (
        <div className="flex items-center gap-2 text-text-faint font-mono text-[12px] py-8 justify-center">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading roadmap…
        </div>
      ) : list.isError ? (
        <div className="border border-border rounded-[8px] p-6 text-center font-mono text-[12px] text-bad">
          Could not load the roadmap. Refresh to try again.
        </div>
      ) : (list.data?.data ?? []).length === 0 ? (
        <div className="border border-border rounded-[8px] p-10 text-center">
          <p className="font-mono text-[12px] text-text-faint">No items in this view yet.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {(list.data?.data ?? []).map((item) => (
            <RoadmapRow
              key={item.id}
              item={item}
              authLoading={authLoading}
              isAuthed={isAuthed}
              voting={upvote.isPending || unvote.isPending}
              onVote={() => {
                if (!isAuthed) return
                if (item.has_voted) unvote.mutate(item.id)
                else upvote.mutate(item.id)
              }}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

interface RoadmapRowProps {
  item: FeedbackItem
  authLoading: boolean
  isAuthed: boolean
  voting: boolean
  onVote: () => void
}

function RoadmapRow({ item, authLoading, isAuthed, voting, onVote }: RoadmapRowProps) {
  const voteDisabled = authLoading || voting

  return (
    <li className="flex items-start gap-3 border border-border rounded-[8px] p-4 bg-bg">
      {/* Vote pill */}
      {isAuthed ? (
        <button
          type="button"
          onClick={onVote}
          disabled={voteDisabled}
          aria-pressed={item.has_voted}
          aria-label={item.has_voted ? 'Remove your vote' : 'Upvote this item'}
          className={cn(
            'flex flex-col items-center justify-center gap-0.5 rounded-[6px] border px-2.5 py-1.5 min-w-[44px] transition-colors',
            item.has_voted
              ? 'border-accent text-accent bg-accent-bg'
              : 'border-border text-text-muted hover:text-text hover:border-border-strong',
            voteDisabled && 'opacity-50 cursor-not-allowed',
          )}
        >
          <ArrowUp className="h-3.5 w-3.5" />
          <span className="font-mono text-[11px] font-medium">{item.vote_count}</span>
        </button>
      ) : (
        <Link
          href={`/login?next=${encodeURIComponent('/feedback')}`}
          aria-label="Sign in to vote"
          className="flex flex-col items-center justify-center gap-0.5 rounded-[6px] border border-border text-text-faint px-2.5 py-1.5 min-w-[44px] hover:text-text hover:border-border-strong"
        >
          <ArrowUp className="h-3.5 w-3.5" />
          <span className="font-mono text-[11px] font-medium">{item.vote_count}</span>
        </Link>
      )}

      {/* Body */}
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2 mb-1.5">
          <span
            className={cn(
              'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
              STATUS_STYLE[item.status],
            )}
          >
            {STATUS_LABEL[item.status]}
          </span>
          <span className="font-mono text-[10.5px] text-text-faint">
            {CATEGORY_LABEL[item.category]}
          </span>
          <time
            dateTime={item.created_at}
            className="font-mono text-[10.5px] text-text-faint ml-auto"
          >
            {formatDate(item.created_at)}
          </time>
        </div>
        <p className="font-mono text-[12.5px] text-text whitespace-pre-wrap leading-relaxed">
          {item.message}
        </p>
        {item.response_message && (
          <div className="mt-3 border-l-2 border-accent pl-3 py-1">
            <p className="font-mono text-[10px] uppercase tracking-wide text-accent mb-1">
              Spanlens team
            </p>
            <p className="font-mono text-[12px] text-text-muted whitespace-pre-wrap leading-relaxed">
              {item.response_message}
            </p>
            {item.changelog_url && (
              <Link
                href={item.changelog_url}
                className="inline-block mt-1.5 font-mono text-[11px] text-accent hover:opacity-80"
              >
                View changelog →
              </Link>
            )}
          </div>
        )}
      </div>
    </li>
  )
}

function SubmitPanel({ onClose }: { onClose: () => void }) {
  const [category, setCategory] = useState<FeedbackCategory>('feature')
  const [message, setMessage] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const submit = useSubmitFeedback()

  const trimmed = message.trim()
  const canSubmit = trimmed.length >= 3 && trimmed.length <= MAX_LEN && !submit.isPending

  function handleSubmit() {
    if (!canSubmit) return
    submit.mutate(
      { message: trimmed, category, source: 'roadmap' },
      {
        onSuccess: () => {
          setSubmitted(true)
          setMessage('')
        },
      },
    )
  }

  if (submitted) {
    return (
      <div className="border border-border rounded-[8px] bg-bg-elev px-6 py-8 text-center">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-good/10">
          <Check className="h-5 w-5 text-good" />
        </div>
        <p className="font-medium text-[15px] text-text mb-1.5">Thanks for the feedback</p>
        <p className="font-mono text-[11.5px] text-text-faint max-w-sm mx-auto mb-5">
          It is in the queue. If it gets traction from other users it climbs the roadmap.
        </p>
        <div className="flex gap-2 justify-center">
          <button
            type="button"
            onClick={() => setSubmitted(false)}
            className="font-mono text-[11px] px-3 py-1.5 rounded border border-border text-text-muted hover:text-text hover:border-border-strong transition-colors"
          >
            Send another
          </button>
          <button
            type="button"
            onClick={onClose}
            className="font-mono text-[11px] px-3 py-1.5 rounded border border-border text-text-muted hover:text-text hover:border-border-strong transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="border border-border rounded-[8px] bg-bg-elev p-5 flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <label className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">
          Category
        </label>
        <div className="flex gap-2 flex-wrap">
          {CATEGORIES.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => setCategory(value)}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[6px] border font-mono text-[11.5px] transition-colors',
                category === value
                  ? 'border-accent text-accent bg-accent-bg'
                  : 'border-border text-text-muted hover:text-text hover:border-border-strong',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <label
          htmlFor="roadmap-message"
          className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint"
        >
          Your message
        </label>
        <textarea
          id="roadmap-message"
          value={message}
          onChange={(e) => setMessage(e.target.value.slice(0, MAX_LEN))}
          rows={5}
          placeholder="I'd love it if Spanlens could…"
          className="w-full resize-y rounded-[6px] border border-border bg-bg px-3 py-2.5 font-mono text-[12.5px] text-text placeholder:text-text-faint focus:outline-none focus:border-accent leading-relaxed"
        />
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10.5px] text-text-faint">
            {trimmed.length < 3 ? 'A few words minimum' : ' '}
          </span>
          <span className="font-mono text-[10.5px] text-text-faint">
            {message.length} / {MAX_LEN}
          </span>
        </div>
      </div>
      {submit.isError && (
        <p className="font-mono text-[11.5px] text-bad">
          Something went wrong. Please try again.
        </p>
      )}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="font-mono text-[12px] px-4 py-2 rounded-[6px] bg-text text-bg hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
        >
          {submit.isPending ? 'Sending…' : 'Send feedback'}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="font-mono text-[11px] px-3 py-1.5 rounded border border-border text-text-muted hover:text-text hover:border-border-strong transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
