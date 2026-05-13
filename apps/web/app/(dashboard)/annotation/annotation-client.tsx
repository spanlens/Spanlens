'use client'

import { useEffect, useMemo, useState } from 'react'
import { Star, Filter, MessageSquare } from 'lucide-react'
import { Topbar } from '@/components/layout/topbar'
import { cn } from '@/lib/utils'
import {
  useAnnotationQueue,
  useSaveHumanEval,
  type AnnotationQueueItem,
} from '@/lib/queries/use-human-evals'
import { usePrompts } from '@/lib/queries/use-prompts'

// Extract assistant response text from various provider shapes.
function extractResponseText(body: Record<string, unknown> | null): string {
  if (!body) return ''
  // OpenAI
  const choices = body.choices as Array<Record<string, unknown>> | undefined
  if (Array.isArray(choices) && choices[0]) {
    const msg = choices[0].message as Record<string, unknown> | undefined
    if (typeof msg?.content === 'string') return msg.content
  }
  // Anthropic
  const content = body.content as Array<Record<string, unknown>> | undefined
  if (Array.isArray(content)) {
    const textBlock = content.find((b) => b.type === 'text')
    if (textBlock && typeof textBlock.text === 'string') return textBlock.text
  }
  // Gemini
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
  value: number | null      // 1..5 or null
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
  const existingRaw = item.human_eval?.raw_score ?? null
  const [stars, setStars] = useState<number | null>(existingRaw)
  const [comment, setComment] = useState(item.human_eval?.comment ?? '')
  const [error, setError] = useState('')

  // Reset on item change
  useEffect(() => {
    setStars(item.human_eval?.raw_score ?? null)
    setComment(item.human_eval?.comment ?? '')
    setError('')
  }, [item.id, item.human_eval?.raw_score, item.human_eval?.comment])

  async function handleSave() {
    setError('')
    if (stars == null) { setError('Pick a rating first'); return }
    try {
      await save.mutateAsync({
        requestId: item.id,
        score: (stars - 1) / 4,   // 1..5 → 0..1
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
      <div className="flex items-center gap-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint">
          Your rating
        </span>
        <StarRating value={stars} onChange={setStars} />
        {stars != null && (
          <span className="font-mono text-[11px] text-text-muted">
            {stars}/5 ({(((stars - 1) / 4) * 100).toFixed(0)} normalized)
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

      <div className="flex items-center justify-between">
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

function ItemCard({ item }: { item: AnnotationQueueItem }) {
  const userMsg = useMemo(() => extractRequestUserText(item.request_body), [item.request_body])
  const responseText = useMemo(() => extractResponseText(item.response_body), [item.response_body])
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="border border-border rounded-[6px] bg-bg overflow-hidden">
      {/* Header */}
      <div className="flex items-center px-[14px] py-[10px] bg-bg-muted border-b border-border">
        <div className="flex-1 min-w-0">
          <p className="font-mono text-[12px] text-text font-medium truncate">
            {item.prompt_name ?? '—'}{item.prompt_version != null ? ` · v${item.prompt_version}` : ''}
          </p>
          <p className="font-mono text-[10px] text-text-faint truncate">
            {item.model} · {new Date(item.created_at).toLocaleString()}
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

      {/* Body — user input + response */}
      <div className="grid grid-cols-2 gap-3 p-3">
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
              onClick={() => setExpanded((v) => !v)}
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

      <ScoringPanel item={item} onSaved={() => { /* react-query invalidation handles refresh */ }} />
    </div>
  )
}

// ── Main page ────────────────────────────────────────────────────────────────

export function AnnotationClient() {
  const prompts = usePrompts()
  const [promptName, setPromptName] = useState<string>('')
  const [unscoredOnly, setUnscoredOnly] = useState(false)
  const [lowJudgeScoreOnly, setLowJudgeScoreOnly] = useState(false)

  const queue = useAnnotationQueue({
    ...(promptName && { promptName }),
    unscoredOnly,
    lowJudgeScoreOnly,
  })

  const items = queue.data ?? []
  const scoredCount = items.filter((i) => !!i.human_eval).length

  return (
    <div className="flex flex-col h-full">
      <Topbar
        crumbs={[{ label: 'Workspace', href: '/dashboard' }, { label: 'Annotation' }]}
      />

      {/* Filter bar */}
      <div className="flex items-center gap-3 px-[22px] py-[12px] border-b border-border bg-bg-muted">
        <Filter className="h-3.5 w-3.5 text-text-faint" />
        <select
          value={promptName}
          onChange={(e) => setPromptName(e.target.value)}
          className="h-7 px-2 rounded-[4px] border border-border bg-bg font-mono text-[11.5px] text-text"
        >
          <option value="">All prompts</option>
          {(prompts.data ?? []).map((p) => (
            <option key={p.id} value={p.name}>{p.name}</option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 font-mono text-[11.5px] text-text-muted cursor-pointer">
          <input
            type="checkbox"
            checked={unscoredOnly}
            onChange={(e) => setUnscoredOnly(e.target.checked)}
          />
          Unscored only
        </label>
        <label className="flex items-center gap-1.5 font-mono text-[11.5px] text-text-muted cursor-pointer">
          <input
            type="checkbox"
            checked={lowJudgeScoreOnly}
            onChange={(e) => setLowJudgeScoreOnly(e.target.checked)}
          />
          Low judge score (&lt;50)
        </label>
        <span className="flex-1" />
        <span className="font-mono text-[11px] text-text-faint">
          {items.length} requests · {scoredCount} rated by you
        </span>
      </div>

      {/* Intro */}
      <div className="px-[22px] py-[10px] border-b border-border flex items-center gap-2 font-mono text-[11px] text-text-muted">
        <MessageSquare className="h-3.5 w-3.5" />
        <span>
          Manually score responses. Your ratings calibrate against LLM judge scores —
          a low correlation signals the judge needs work.
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-[22px] py-[14px] space-y-3">
        {queue.isLoading ? (
          [1, 2, 3].map((i) => <div key={i} className="h-40 bg-bg-elev rounded animate-pulse" />)
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-2 text-text-muted">
            <p className="font-mono text-[13px]">No requests match these filters.</p>
            <p className="font-mono text-[11px] text-text-faint">
              Loosen filters or send some requests tagged with a prompt version first.
            </p>
          </div>
        ) : (
          items.map((item) => <ItemCard key={item.id} item={item} />)
        )}
      </div>
    </div>
  )
}
