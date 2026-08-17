'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Filter, MessageSquare, Star } from 'lucide-react'
import { Topbar } from '@/components/layout/topbar'
import { cn } from '@/lib/utils'
import { StatusPill } from '@/components/ui/primitives'
import { DEMO_ANNOTATION_QUEUE } from '@/lib/demo-data'
import type { AnnotationQueueItem } from '@/lib/queries/use-human-evals'
import {
  Board,
  TOPBAR_BLEED,
  FilterBar,
  StatCard,
  Well,
  CONTROL,
  CONTROL_TEXT,
} from '../../(dashboard)/_board/surfaces'

function extractResponseText(body: Record<string, unknown> | null): string {
  if (!body) return ''
  const choices = body.choices as Array<Record<string, unknown>> | undefined
  if (Array.isArray(choices) && choices[0]) {
    const msg = choices[0].message as Record<string, unknown> | undefined
    if (typeof msg?.content === 'string') return msg.content
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
  return n == null ? '—' : (n * 100).toFixed(0)
}

function StarRating({ value, onChange }: { value: number | null; onChange: (v: number) => void }) {
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
            size={18}
            className={cn(
              'transition-colors',
              n <= display ? 'fill-accent text-accent' : 'fill-transparent text-text-faint hover:text-text-muted',
            )}
          />
        </button>
      ))}
    </div>
  )
}

interface ItemCardProps {
  item: AnnotationQueueItem
  focused: boolean
  localScore: number | null
  onRate: (raw: number) => void
  onFocus: () => void
  cardRef: (el: HTMLDivElement | null) => void
}

function ItemCard({ item, focused, localScore, onRate, onFocus, cardRef }: ItemCardProps) {
  const userMsg = useMemo(() => extractRequestUserText(item.request_body), [item.request_body])
  const responseText = useMemo(() => extractResponseText(item.response_body), [item.response_body])
  const [expanded, setExpanded] = useState(false)
  const [comment, setComment] = useState(item.human_eval?.comment ?? '')

  const score = localScore ?? item.human_eval?.raw_score ?? null

  return (
    <div
      ref={cardRef}
      onClick={onFocus}
      className={cn(
        'card-surface rounded-card overflow-hidden transition-colors',
        focused && 'border-accent-border ring-1 ring-accent-border/30',
      )}
    >
      <div className="flex items-center gap-2 border-b border-border bg-bg-muted px-5 py-3">
        <div className="flex-1 min-w-0">
          <p className="truncate font-mono text-[12px] text-text">
            {item.prompt_name ?? '—'}{item.prompt_version != null ? ` · v${item.prompt_version}` : ''}
          </p>
          <p className="truncate font-mono text-[10.5px] text-text-faint">
            {item.model} · {new Date(item.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {item.llm_judge_score != null && (
            <div className="flex items-center gap-1 font-mono text-[10.5px] text-text-muted">
              <span className="text-text-faint">Judge:</span>
              <span className={cn(
                'font-medium tabular-nums',
                item.llm_judge_score < 0.4 ? 'text-bad' : item.llm_judge_score < 0.7 ? 'text-warn' : 'text-good',
              )}>
                {fmtScore(item.llm_judge_score)}
              </span>
            </div>
          )}
          {score != null && (
            <StatusPill variant="good">You: {(((score - 1) / 4) * 100).toFixed(0)}</StatusPill>
          )}
        </div>
      </div>

      {/* Input and response sit in sunk wells, matching the item pane on the
          board: single column on mobile, side by side from sm. */}
      <div className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-2">
        <div className="min-w-0">
          <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-text-faint">User input</p>
          <Well>
            <p className={cn('whitespace-pre-wrap font-mono text-[12px] leading-[1.65] text-text-muted', !expanded && 'line-clamp-3')}>
              {userMsg || '—'}
            </p>
          </Well>
        </div>
        <div className="min-w-0">
          <div className="mb-1.5 flex items-center justify-between">
            <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-faint">Response</p>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v) }}
              aria-expanded={expanded}
              className="font-mono text-[10.5px] text-text-faint transition-colors hover:text-text"
            >
              {expanded ? 'collapse' : 'expand'}
            </button>
          </div>
          <Well>
            <p className={cn('whitespace-pre-wrap font-mono text-[12px] leading-[1.65] text-text', !expanded && 'line-clamp-5')}>
              {responseText || '—'}
            </p>
          </Well>
        </div>
      </div>

      <div className="space-y-3 border-t border-border bg-bg-muted px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-faint">Your rating</span>
          <StarRating value={score} onChange={onRate} />
          {score != null && (
            <span className="font-mono text-[11px] text-text-muted tabular-nums" title={`${(((score - 1) / 4) * 100).toFixed(0)} normalized`}>
              {score}/5
            </span>
          )}
        </div>
        <div>
          <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.1em] text-text-faint">
            Comment (optional)
          </label>
          <textarea
            value={comment}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setComment(e.target.value)}
            rows={2}
            placeholder="Why this rating?"
            className="w-full resize-none rounded-md border border-border bg-bg-elev px-3 py-2 font-mono text-[12px] text-text placeholder:text-text-faint focus:border-border-strong focus:outline-none"
          />
        </div>
        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); alert('Saving ratings, sign up to use this') }}
            disabled={score == null}
            className="rounded-full bg-text px-3.5 py-2 text-[12.5px] font-semibold text-bg transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {item.human_eval ? 'Update' : 'Save rating'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function DemoAnnotationPage() {
  const [promptName, setPromptName] = useState<string>('')
  const [unscoredOnly, setUnscoredOnly] = useState(false)
  const [lowJudgeScoreOnly, setLowJudgeScoreOnly] = useState(false)
  // Local ratings so the demo feels interactive (resets on reload).
  const [localScores, setLocalScores] = useState<Record<string, number>>({})

  const promptNames = useMemo(() => {
    const set = new Set<string>()
    for (const q of DEMO_ANNOTATION_QUEUE) if (q.prompt_name) set.add(q.prompt_name)
    return [...set]
  }, [])

  const items = useMemo(() => {
    return DEMO_ANNOTATION_QUEUE.filter((q) => {
      if (promptName && q.prompt_name !== promptName) return false
      if (unscoredOnly && q.human_eval) return false
      if (lowJudgeScoreOnly && !(q.llm_judge_score != null && q.llm_judge_score < 0.5)) return false
      return true
    })
  }, [promptName, unscoredOnly, lowJudgeScoreOnly])

  // Keyboard focus — clamp on render instead of resetting in an effect.
  const [rawFocusedIdx, setRawFocusedIdx] = useState(0)
  const focusedIdx = items.length === 0 ? 0 : Math.min(rawFocusedIdx, items.length - 1)
  const cardRefs = useRef<(HTMLDivElement | null)[]>([])

  const rate = useCallback((id: string, raw: number) => {
    setLocalScores((prev) => ({ ...prev, [id]: raw }))
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return

      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault()
        setRawFocusedIdx((i) => Math.min(i + 1, items.length - 1))
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault()
        setRawFocusedIdx((i) => Math.max(i - 1, 0))
      } else if (e.key >= '1' && e.key <= '5') {
        const focused = items[focusedIdx]
        if (focused) {
          e.preventDefault()
          rate(focused.id, Number(e.key))
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [items, focusedIdx, rate])

  useEffect(() => {
    cardRefs.current[focusedIdx]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [focusedIdx])

  // Stat strip — computed over the unfiltered queue.
  const total = DEMO_ANNOTATION_QUEUE.length
  const ratedCount = useMemo(() => {
    let n = 0
    for (const q of DEMO_ANNOTATION_QUEUE) {
      if (localScores[q.id] != null || q.human_eval) n += 1
    }
    return n
  }, [localScores])
  const avgHuman = useMemo(() => {
    const raws: number[] = []
    for (const q of DEMO_ANNOTATION_QUEUE) {
      const raw = localScores[q.id] ?? q.human_eval?.raw_score ?? null
      if (raw != null) raws.push(raw)
    }
    if (raws.length === 0) return '—'
    return (raws.reduce((a, b) => a + b, 0) / raws.length).toFixed(1)
  }, [localScores])
  const judgeCoverage = useMemo(() => {
    const covered = DEMO_ANNOTATION_QUEUE.filter((q) => q.llm_judge_score != null).length
    return total > 0 ? `${Math.round((covered / total) * 100)}%` : '—'
  }, [total])

  const scoredInView = items.filter((i) => localScores[i.id] != null || i.human_eval).length

  return (
    <div>
      <div className={TOPBAR_BLEED}>
        <Topbar crumbs={[{ label: 'Demo', href: '/demo/dashboard' }, { label: 'Annotation' }]} />
      </div>

      <Board>
      {/* Stat strip */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'In queue',       value: String(total),                 foot: 'sampled from live traffic' },
          { label: 'Rated by you',   value: `${ratedCount}/${total}`,      foot: `${total - ratedCount} still to rate` },
          { label: 'Avg human',      value: avgHuman,                      foot: 'across rated items' },
          { label: 'Judge coverage', value: judgeCoverage,                 foot: 'of sampled requests' },
        ].map((s) => (
          <StatCard key={s.label} label={s.label} value={s.value} foot={s.foot} />
        ))}
      </div>

      {/* Filter bar */}
      <FilterBar>
        <Filter className="h-3.5 w-3.5 text-text-faint" />
        <select
          value={promptName}
          onChange={(e) => setPromptName(e.target.value)}
          aria-label="Filter by prompt"
          className={cn(CONTROL, CONTROL_TEXT, 'px-3')}
        >
          <option value="">All prompts</option>
          {promptNames.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <label className={cn(CONTROL, CONTROL_TEXT, 'inline-flex cursor-pointer items-center gap-2 px-3.5 font-normal text-text-muted')}>
          <input type="checkbox" checked={unscoredOnly} onChange={(e) => setUnscoredOnly(e.target.checked)} className="accent-accent" />
          Unscored only
        </label>
        <label className={cn(CONTROL, CONTROL_TEXT, 'inline-flex cursor-pointer items-center gap-2 px-3.5 font-normal text-text-muted')}>
          <input type="checkbox" checked={lowJudgeScoreOnly} onChange={(e) => setLowJudgeScoreOnly(e.target.checked)} className="accent-accent" />
          Low judge score (&lt;50)
        </label>
        <span className="flex-1" />
        <span className="font-mono text-[11px] text-text-faint tabular-nums">
          {items.length} requests · {scoredInView} rated
        </span>
      </FilterBar>

      <div className="card-surface rounded-card flex flex-wrap items-center gap-2 px-5 py-3.5 font-mono text-[11px] text-text-muted">
        <MessageSquare className="h-3.5 w-3.5 shrink-0" />
        <span>
          Manually score responses to calibrate against LLM judge scores. A low correlation signals the judge needs work.
          Keyboard: ↑ ↓ or j k to move, 1-5 to rate.
        </span>
      </div>

      <div className="flex flex-col gap-3">
        {items.length === 0 ? (
          <div className="card-surface rounded-card flex h-64 flex-col items-center justify-center gap-2 text-text-muted">
            <p className="text-[13.5px] font-semibold text-text">No requests match these filters.</p>
          </div>
        ) : (
          items.map((item, idx) => (
            <ItemCard
              key={item.id}
              item={item}
              focused={idx === focusedIdx}
              localScore={localScores[item.id] ?? null}
              onRate={(raw) => { setRawFocusedIdx(idx); rate(item.id, raw) }}
              onFocus={() => setRawFocusedIdx(idx)}
              cardRef={(el) => { cardRefs.current[idx] = el }}
            />
          ))
        )}
      </div>
      </Board>
    </div>
  )
}
