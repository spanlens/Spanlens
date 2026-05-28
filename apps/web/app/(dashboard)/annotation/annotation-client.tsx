'use client'

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Filter, MessageSquare, Star } from 'lucide-react'
import { Topbar, LiveDot } from '@/components/layout/topbar'
import { cn, formatDateTime } from '@/lib/utils'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  useAnnotationQueue,
  useSaveHumanEval,
  type AnnotationQueueItem,
} from '@/lib/queries/use-human-evals'
import { usePrompts } from '@/lib/queries/use-prompts'

// Hydration-safe mounted gate, same pattern as the other overhauled pages.
const subscribeNoop = () => () => {}
const getTrue = () => true
const getFalse = () => false
function useMounted(): boolean {
  return useSyncExternalStore(subscribeNoop, getTrue, getFalse)
}

const PAGE_SIZE = 25

// Extract assistant response text from various provider shapes.
function extractResponseText(body: Record<string, unknown> | null): string {
  if (!body) return ''
  const choices = body.choices as Array<Record<string, unknown>> | undefined
  if (Array.isArray(choices) && choices[0]) {
    const msg = choices[0].message as Record<string, unknown> | undefined
    if (typeof msg?.content === 'string') return msg.content
  }
  const content = body.content as Array<Record<string, unknown>> | undefined
  if (Array.isArray(content)) {
    const textBlock = content.find((b) => b.type === 'text')
    if (textBlock && typeof textBlock.text === 'string') return textBlock.text
  }
  const candidates = body.candidates as Array<Record<string, unknown>> | undefined
  if (Array.isArray(candidates) && candidates[0]) {
    const cContent = (candidates[0].content as Record<string, unknown> | undefined)
    const parts = cContent?.parts as Array<Record<string, unknown>> | undefined
    if (Array.isArray(parts) && parts[0] && typeof parts[0].text === 'string') return parts[0].text
  }
  return ''
}

function extractRequestUserText(body: Record<string, unknown> | null): string {
  if (!body) return ''
  const messages = body.messages as Array<Record<string, unknown>> | undefined
  if (Array.isArray(messages)) {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user')
    if (lastUser && typeof lastUser.content === 'string') return lastUser.content
  }
  return ''
}

function fmtScore(n: number | null | undefined): string {
  if (n == null) return '—'
  return (n * 100).toFixed(0)
}

// ── Star rating ─────────────────────────────────────────────────────────────

function StarRating({
  value,
  onChange,
  size = 18,
}: {
  value: number | null
  onChange: (v: number) => void
  size?: number
}) {
  const [hover, setHover] = useState<number | null>(null)
  const display = hover ?? value ?? 0
  return (
    <div className="flex items-center gap-0.5" onMouseLeave={() => setHover(null)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          onMouseEnter={() => setHover(n)}
          className="p-0.5"
          aria-label={`Rate ${n}`}
        >
          <Star
            size={size}
            className={cn(
              'transition-colors',
              n <= display
                ? 'fill-accent text-accent'
                : 'fill-transparent text-text-faint hover:text-text-muted',
            )}
          />
        </button>
      ))}
    </div>
  )
}

// ── Scoring panel ───────────────────────────────────────────────────────────

function ScoringPanel({
  item,
  onSaved,
}: {
  item: AnnotationQueueItem
  onSaved: () => void
}) {
  const save = useSaveHumanEval()
  const [stars, setStars] = useState<number | null>(item.human_eval?.raw_score ?? null)
  const [comment, setComment] = useState(item.human_eval?.comment ?? '')
  const [error, setError] = useState('')

  async function handleSave() {
    setError('')
    if (stars == null) { setError('Pick a rating first'); return }
    try {
      await save.mutateAsync({
        requestId: item.id,
        score: (stars - 1) / 4,
        rawScore: stars,
        ...(comment.trim() && { comment: comment.trim() }),
      })
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    }
  }

  const isUpdate = !!item.human_eval

  return (
    <div className="border-t border-border p-4 bg-bg-elev space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint">
          Your rating
        </span>
        <StarRating value={stars} onChange={setStars} />
        {/* Normalized math is an engineering detail; expose it only as a
            tooltip on hover so the rating row stays visually quiet. */}
        {stars != null && (
          <span
            className="font-mono text-[11px] text-text-muted"
            title={`Normalized score = (${stars} − 1) / 4 = ${(((stars - 1) / 4) * 100).toFixed(0)}`}
          >
            {stars}/5
          </span>
        )}
      </div>

      <div>
        <label className="block font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint mb-1">
          Comment (optional)
        </label>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={2}
          placeholder="Why this rating?"
          className="w-full px-2 py-2 rounded-[5px] border border-border bg-bg font-mono text-[12px] text-text placeholder:text-text-faint focus:outline-none focus:border-border-strong resize-none"
        />
      </div>

      {error && <p className="font-mono text-[11.5px] text-bad">{error}</p>}

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="font-mono text-[10.5px] text-text-faint">
          {isUpdate ? 'You previously rated this. Save to overwrite.' : 'Not yet rated by you.'}
        </p>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={save.isPending || stars == null}
          className="font-mono text-[11.5px] px-3 py-[6px] rounded-[5px] bg-text text-bg font-medium hover:opacity-90 disabled:opacity-40"
        >
          {save.isPending ? 'Saving…' : isUpdate ? 'Update' : 'Save rating'}
        </button>
      </div>
    </div>
  )
}

// ── Item card ───────────────────────────────────────────────────────────────

function ItemCard({
  item,
  focused,
  onFocus,
}: {
  item: AnnotationQueueItem
  focused: boolean
  onFocus: () => void
}) {
  const userMsg = useMemo(() => extractRequestUserText(item.request_body), [item.request_body])
  const responseText = useMemo(() => extractResponseText(item.response_body), [item.response_body])
  const [expanded, setExpanded] = useState(false)

  return (
    <div
      onClick={onFocus}
      className={cn(
        'border rounded-[6px] bg-bg overflow-hidden transition-colors',
        focused ? 'border-accent-border ring-1 ring-accent-border/30' : 'border-border',
      )}
    >
      {/* Header */}
      <div className="flex items-center px-[14px] py-[10px] bg-bg-muted border-b border-border gap-2 flex-wrap">
        <div className="flex-1 min-w-0">
          <p className="font-mono text-[12px] text-text font-medium truncate">
            {item.prompt_name ?? '—'}{item.prompt_version != null ? ` · v${item.prompt_version}` : ''}
          </p>
          <p className="font-mono text-[10px] text-text-faint truncate">
            {item.model} · {formatDateTime(item.created_at)}
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {item.llm_judge_score != null && (
            <div className="flex items-center gap-1 font-mono text-[10.5px] text-text-muted">
              <span className="text-text-faint">Judge:</span>
              <span className={cn(
                'font-medium',
                item.llm_judge_score < 0.4 ? 'text-bad' : item.llm_judge_score < 0.7 ? 'text-warn' : 'text-good',
              )}>
                {fmtScore(item.llm_judge_score)}
              </span>
            </div>
          )}
          {item.human_eval && (
            <div className="flex items-center gap-1 font-mono text-[10.5px] text-good">
              <span>You: {fmtScore(item.human_eval.score)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Body — single column on mobile, side-by-side from sm. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-1">
            User input
          </p>
          <p className={cn(
            'font-mono text-[11.5px] text-text-muted leading-relaxed whitespace-pre-wrap',
            !expanded && 'line-clamp-3',
          )}>
            {userMsg || '—'}
          </p>
        </div>
        <div className="min-w-0">
          <div className="flex items-center justify-between mb-1">
            <p className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">
              Response
            </p>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v) }}
              className="font-mono text-[10px] text-text-faint hover:text-text"
            >
              {expanded ? 'collapse' : 'expand'}
            </button>
          </div>
          <p className={cn(
            'font-mono text-[12px] text-text leading-relaxed whitespace-pre-wrap',
            !expanded && 'line-clamp-5',
          )}>
            {responseText || '—'}
          </p>
        </div>
      </div>

      <ScoringPanel key={item.id} item={item} onSaved={() => { /* react-query invalidation handles refresh */ }} />
    </div>
  )
}

// ── Main page ────────────────────────────────────────────────────────────────

export function AnnotationClient() {
  const router = useRouter()
  const sp = useSearchParams()
  const mounted = useMounted()

  const prompts = usePrompts()

  // URL-backed filters — shareable + survive reload.
  const promptName = sp.get('prompt') ?? ''
  const unscoredOnly = sp.get('unscored') === '1'
  const lowJudgeScoreOnly = sp.get('lowjudge') === '1'
  const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10))

  function updateQuery(updates: Record<string, string | null>) {
    const next = new URLSearchParams(sp.toString())
    Object.entries(updates).forEach(([k, v]) => {
      if (v == null || v === '') next.delete(k)
      else next.set(k, v)
    })
    router.replace(`/annotation?${next.toString()}`)
  }

  const queue = useAnnotationQueue({
    ...(promptName && { promptName }),
    unscoredOnly,
    lowJudgeScoreOnly,
  })

  const items = useMemo(() => queue.data ?? [], [queue.data])
  const scoredCount = items.filter((i) => !!i.human_eval).length
  const humanScores = items
    .map((i) => i.human_eval?.score)
    .filter((s): s is number => s != null)
  const avgHuman = humanScores.length > 0
    ? humanScores.reduce((a, b) => a + b, 0) / humanScores.length
    : null
  const judgeCount = items.filter((i) => i.llm_judge_score != null).length

  // Client-side pagination — server returns the whole queue up to its
  // internal limit. Slice to a reasonable page so large queues stay
  // responsive.
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE))
  const pageItems = items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  // Keyboard nav: ↓/j to focus next, ↑/k to focus prev, 1..5 to quick-rate
  // the focused item. Persists across the page, but is always clamped to a
  // valid index when the visible items change (filter switch, pagination)
  // so we never highlight a card that no longer exists.
  const [rawFocusedIdx, setFocusedIdx] = useState(0)
  const focusedIdx = pageItems.length === 0
    ? 0
    : Math.min(rawFocusedIdx, pageItems.length - 1)

  const save = useSaveHumanEval()
  useEffect(() => {
    if (pageItems.length === 0) return
    function onKey(e: KeyboardEvent) {
      // Skip when the user is typing in the textarea / input.
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable)) return

      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault()
        setFocusedIdx((i) => Math.min(pageItems.length - 1, i + 1))
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault()
        setFocusedIdx((i) => Math.max(0, i - 1))
      } else if (['1', '2', '3', '4', '5'].includes(e.key)) {
        const stars = Number(e.key)
        const target = pageItems[focusedIdx]
        if (!target) return
        e.preventDefault()
        save.mutate({
          requestId: target.id,
          score: (stars - 1) / 4,
          rawScore: stars,
        })
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [pageItems, focusedIdx, save])

  // Scroll focused card into view on focus change.
  const cardsRef = useRef<Array<HTMLDivElement | null>>([])
  useEffect(() => {
    const el = cardsRef.current[focusedIdx]
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [focusedIdx])

  return (
    <div className="-mx-4 -my-4 md:-mx-8 md:-my-7 flex flex-col min-h-screen">
      <div className="sticky top-0 z-20 bg-bg">
        <Topbar
          crumbs={[{ label: 'Annotation' }]}
          right={
            <div className="flex items-center gap-3">
              <LiveDot refetching={mounted && queue.isFetching} />
              <button
                type="button"
                onClick={() => void queue.refetch()}
                disabled={mounted && queue.isFetching}
                title="Refresh now"
                className="font-mono text-[11px] text-text-muted hover:text-text border border-border rounded px-2 py-1 transition-colors disabled:opacity-40"
              >
                <span className={cn('inline-block', mounted && queue.isFetching && 'animate-spin')}>↻</span>
              </button>
            </div>
          }
        />
        <h1 className="sr-only">Annotation</h1>
      </div>

      {/* Stat strip — Queue / Rated / Avg human / Judge coverage. Wraps on mobile. */}
      <div className="shrink-0 border-b border-border">
        <div className="grid grid-cols-2 md:grid-cols-4">
          {[
            { label: 'In queue',       value: String(items.length) },
            { label: 'Rated by you',   value: String(scoredCount) },
            { label: 'Avg human score', value: avgHuman != null ? fmtScore(avgHuman) : '—' },
            { label: 'Judge coverage', value: items.length > 0 ? `${Math.round((judgeCount / items.length) * 100)}%` : '—' },
          ].map((s, i) => (
            <div
              key={s.label}
              className={cn(
                'px-[18px] py-[14px] border-border',
                i % 2 === 0 && 'border-r',
                i === 1 && 'border-b md:border-b-0 md:border-r',
                i === 0 && 'border-b md:border-b-0',
                i === 2 && 'md:border-r',
              )}
            >
              <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-2">{s.label}</div>
              <span className="text-[22px] sm:text-[24px] font-medium leading-none tracking-[-0.6px] tabular-nums text-text">
                {mounted ? s.value : ' '}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-3 px-[22px] py-[12px] border-b border-border bg-bg-muted flex-wrap">
        <Filter className="h-3.5 w-3.5 text-text-faint" />
        <Select
          {...(promptName ? { value: promptName } : {})}
          onValueChange={(v) => updateQuery({ prompt: v || null, page: null })}
        >
          <SelectTrigger className="w-auto h-7 rounded-[4px] text-[11.5px]">
            <SelectValue placeholder="All prompts" />
          </SelectTrigger>
          <SelectContent>
            {(prompts.data ?? []).map((p) => (
              <SelectItem key={p.id} value={p.name}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {promptName && (
          <button
            type="button"
            onClick={() => updateQuery({ prompt: null, page: null })}
            className="font-mono text-[11px] text-text-faint hover:text-text transition-colors"
          >
            clear prompt
          </button>
        )}
        <label className="flex items-center gap-1.5 font-mono text-[11.5px] text-text-muted cursor-pointer">
          <input
            type="checkbox"
            checked={unscoredOnly}
            onChange={(e) => updateQuery({ unscored: e.target.checked ? '1' : null, page: null })}
          />
          Unscored only
        </label>
        <label className="flex items-center gap-1.5 font-mono text-[11.5px] text-text-muted cursor-pointer">
          <input
            type="checkbox"
            checked={lowJudgeScoreOnly}
            onChange={(e) => updateQuery({ lowjudge: e.target.checked ? '1' : null, page: null })}
          />
          Low judge score (&lt;50)
        </label>
        <span className="flex-1" />
        <span className="font-mono text-[11px] text-text-faint">
          {mounted ? `${items.length} requests · ${scoredCount} rated by you` : ' '}
        </span>
      </div>

      {/* Intro banner with docs link + keyboard hint */}
      <div className="px-[22px] py-[10px] border-b border-border flex items-center gap-2 font-mono text-[11px] text-text-muted flex-wrap">
        <MessageSquare className="h-3.5 w-3.5 shrink-0" />
        <span>
          Manually score responses. Your ratings calibrate the LLM judge — low correlation
          signals the judge needs work.
        </span>
        <span className="hidden md:inline text-text-faint">·</span>
        <span className="hidden md:inline text-text-faint">
          Shortcuts: <kbd className="px-1 border border-border rounded text-[10px]">↑↓</kbd> nav
          {' · '}
          <kbd className="px-1 border border-border rounded text-[10px]">1-5</kbd> rate
        </span>
        <Link
          href="/docs/features/annotation"
          className="text-text hover:opacity-80 transition-opacity ml-auto"
        >
          How annotation works →
        </Link>
      </div>

      <div className="px-[22px] py-[14px] space-y-3">
        {!mounted || queue.isLoading ? (
          [1, 2, 3].map((i) => <div key={i} className="h-40 bg-bg-elev rounded animate-pulse" />)
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-2 text-text-muted">
            <MessageSquare className="h-10 w-10 text-text-faint" />
            <p className="font-mono text-[13px]">No requests match these filters.</p>
            <p className="font-mono text-[11px] text-text-faint">
              Loosen filters or send some requests tagged with a prompt version first.
            </p>
            <Link
              href="/docs/features/annotation"
              className="font-mono text-[11.5px] mt-1 px-2.5 py-1 rounded border border-border text-text-muted hover:text-text hover:border-border-strong transition-colors"
            >
              How annotation works →
            </Link>
          </div>
        ) : (
          <>
            {pageItems.map((item, idx) => (
              <div key={item.id} ref={(el) => { cardsRef.current[idx] = el }}>
                <ItemCard
                  item={item}
                  focused={idx === focusedIdx}
                  onFocus={() => setFocusedIdx(idx)}
                />
              </div>
            ))}

            {/* Pagination — First / Prev / Next / Last + caption. Hidden when
                everything fits on one page. */}
            {items.length > PAGE_SIZE && (
              <div className="flex items-center justify-between mt-2 font-mono text-[11px] flex-wrap gap-3">
                <div className="text-text-faint">
                  Page {page} of {totalPages} · {pageItems.length} / {items.length}
                </div>
                <div className="flex gap-2">
                  <button
                    disabled={page <= 1}
                    onClick={() => updateQuery({ page: null })}
                    className="px-2.5 py-1.5 border border-border rounded-[6px] text-text hover:bg-bg-elev disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    First
                  </button>
                  <button
                    disabled={page <= 1}
                    onClick={() => updateQuery({ page: String(page - 1) })}
                    className="px-3 py-1.5 border border-border rounded-[6px] text-text hover:bg-bg-elev disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Prev
                  </button>
                  <button
                    disabled={page >= totalPages}
                    onClick={() => updateQuery({ page: String(page + 1) })}
                    className="px-3 py-1.5 border border-border rounded-[6px] text-text hover:bg-bg-elev disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Next
                  </button>
                  <button
                    disabled={page >= totalPages}
                    onClick={() => updateQuery({ page: String(totalPages) })}
                    className="px-2.5 py-1.5 border border-border rounded-[6px] text-text hover:bg-bg-elev disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Last
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
