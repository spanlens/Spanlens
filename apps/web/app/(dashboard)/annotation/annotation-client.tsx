'use client'

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Filter, MessageSquare, Star, Check, X, Type as TypeIcon } from 'lucide-react'
import { Topbar, LiveDot } from '@/components/layout/topbar'
import { cn, formatDateTime } from '@/lib/utils'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  useAnnotationQueue,
  useSaveHumanEval,
  type AnnotationQueueItem,
} from '@/lib/queries/use-human-evals'
import { usePrompts } from '@/lib/queries/use-prompts'
import { useScoreConfigs, type ScoreConfig } from '@/lib/queries/use-score-configs'

/**
 * Truncate a long label so the per-item "You" badge doesn't blow up
 * the header when a categorical category is verbose.
 */
function truncate(value: string, max: number): string {
  if (value.length <= max) return value
  return value.slice(0, max - 1) + '…'
}

/**
 * Render the user's existing score as a short string for the
 * ItemCard header. Falls back to the legacy `score` column when the
 * row predates 4B.1 typed columns.
 */
function existingScoreLabel(
  he: AnnotationQueueItem['human_eval'],
  config: ScoreConfig | null,
): string {
  if (!he) return ''
  if (he.value_string != null) return truncate(he.value_string, 18)
  if (he.value_boolean != null) {
    if (config?.data_type === 'BOOLEAN') {
      return he.value_boolean
        ? (config.bool_true_label ?? 'Pass')
        : (config.bool_false_label ?? 'Fail')
    }
    return he.value_boolean ? 'Pass' : 'Fail'
  }
  if (he.value_number != null) return ((he.value_number) * 100).toFixed(0)
  if (he.score != null) return ((he.score) * 100).toFixed(0)
  return 'rated'
}

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

// ── Categorical / boolean / text rating widgets ─────────────────────────────

function CategoricalRating({
  categories,
  value,
  onChange,
}: {
  categories: string[]
  value: string | null
  onChange: (v: string) => void
}) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {categories.map((c) => {
        const selected = value === c
        return (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            className={cn(
              'rounded-[5px] border px-2 py-1 font-mono text-[11.5px] transition-colors',
              selected
                ? 'border-accent bg-accent-bg/40 text-text'
                : 'border-border bg-bg text-text-muted hover:border-border-strong',
            )}
          >
            {c}
          </button>
        )
      })}
    </div>
  )
}

function BooleanRating({
  value,
  onChange,
  trueLabel,
  falseLabel,
}: {
  value: boolean | null
  onChange: (v: boolean) => void
  trueLabel: string
  falseLabel: string
}) {
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => onChange(true)}
        className={cn(
          'flex items-center gap-1 rounded-[5px] border px-2.5 py-1 font-mono text-[11.5px] transition-colors',
          value === true
            ? 'border-good bg-good/15 text-good'
            : 'border-border bg-bg text-text-muted hover:border-border-strong',
        )}
      >
        <Check className="h-3.5 w-3.5" />
        {trueLabel}
      </button>
      <button
        type="button"
        onClick={() => onChange(false)}
        className={cn(
          'flex items-center gap-1 rounded-[5px] border px-2.5 py-1 font-mono text-[11.5px] transition-colors',
          value === false
            ? 'border-bad bg-bad/15 text-bad'
            : 'border-border bg-bg text-text-muted hover:border-border-strong',
        )}
      >
        <X className="h-3.5 w-3.5" />
        {falseLabel}
      </button>
    </div>
  )
}

function TextRating({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={3}
      placeholder="Your label / score / note for this response…"
      className="w-full rounded-[5px] border border-border bg-bg px-2 py-2 font-mono text-[12px] text-text placeholder:text-text-faint focus:outline-none focus:border-border-strong resize-none"
    />
  )
}

// ── Scoring panel ───────────────────────────────────────────────────────────

interface ScoringPanelProps {
  item: AnnotationQueueItem
  config: ScoreConfig | null
  onSaved: () => void
}

function ScoringPanel({ item, config, onSaved }: ScoringPanelProps) {
  const save = useSaveHumanEval()

  // Seed widget state from any existing typed value on the row. We
  // deliberately key each input on its primitive type so changing the
  // active config doesn't carry stale state across.
  const [numericValue, setNumericValue] = useState<number | null>(
    item.human_eval?.value_number ?? item.human_eval?.raw_score ?? null,
  )
  const [categoricalValue, setCategoricalValue] = useState<string | null>(
    item.human_eval?.value_string ?? null,
  )
  const [booleanValue, setBooleanValue] = useState<boolean | null>(
    item.human_eval?.value_boolean ?? null,
  )
  const [textValue, setTextValue] = useState<string>(
    item.human_eval?.value_string ?? '',
  )
  const [comment, setComment] = useState(item.human_eval?.comment ?? '')
  const [error, setError] = useState('')

  if (!config) {
    return (
      <div className="border-t border-border p-4 bg-bg-elev font-mono text-[11.5px] text-text-faint">
        Workspace has no score config. Create one under{' '}
        <Link href="/settings/score-configs" className="text-accent underline">
          Settings → Score configs
        </Link>{' '}
        to start rating.
      </div>
    )
  }

  // Resolve the raw value that the active widget owns, then build the
  // mutation payload from there. The server validates against the
  // config type and 400s on mismatch.
  function buildPayload(): {
    requestId: string
    scoreConfigId: string
    value: number | string | boolean
    rawScore?: number
    comment?: string
  } | null {
    if (!config) return null

    if (config.data_type === 'NUMERIC') {
      if (numericValue == null) return null
      const min = config.min_value ?? 0
      const max = config.max_value ?? 1
      // If the workspace is still on the legacy 0..1 default and the
      // user is using the 1..5 stars widget, normalise here so the
      // server stores a 0..1 value_number.
      const isStars = min === 0 && max === 1
      const normalised = isStars ? (numericValue - 1) / 4 : numericValue
      const result: { requestId: string; scoreConfigId: string; value: number; rawScore?: number; comment?: string } = {
        requestId: item.id,
        scoreConfigId: config.id,
        value: normalised,
      }
      if (isStars) result.rawScore = numericValue
      if (comment.trim()) result.comment = comment.trim()
      return result
    }
    if (config.data_type === 'CATEGORICAL') {
      if (!categoricalValue) return null
      const result: { requestId: string; scoreConfigId: string; value: string; comment?: string } = {
        requestId: item.id,
        scoreConfigId: config.id,
        value: categoricalValue,
      }
      if (comment.trim()) result.comment = comment.trim()
      return result
    }
    if (config.data_type === 'BOOLEAN') {
      if (booleanValue == null) return null
      const result: { requestId: string; scoreConfigId: string; value: boolean; comment?: string } = {
        requestId: item.id,
        scoreConfigId: config.id,
        value: booleanValue,
      }
      if (comment.trim()) result.comment = comment.trim()
      return result
    }
    // TEXT
    if (!textValue.trim()) return null
    const result: { requestId: string; scoreConfigId: string; value: string; comment?: string } = {
      requestId: item.id,
      scoreConfigId: config.id,
      value: textValue.trim(),
    }
    if (comment.trim()) result.comment = comment.trim()
    return result
  }

  async function handleSave() {
    setError('')
    const payload = buildPayload()
    if (!payload) {
      setError(
        config?.data_type === 'TEXT'
          ? 'Write something first'
          : 'Pick a rating first',
      )
      return
    }
    try {
      await save.mutateAsync(payload)
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    }
  }

  const isUpdate = !!item.human_eval
  const isStarsLayout =
    config.data_type === 'NUMERIC'
    && (config.min_value ?? 0) === 0
    && (config.max_value ?? 1) === 1

  return (
    <div className="border-t border-border p-4 bg-bg-elev space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint">
          {config.name}
        </span>

        {config.data_type === 'NUMERIC' && (
          isStarsLayout ? (
            <>
              <StarRating
                value={numericValue == null ? null : Math.max(1, Math.min(5, Math.round(numericValue <= 1 ? numericValue * 4 + 1 : numericValue)))}
                onChange={(stars) => setNumericValue(stars)}
              />
              {numericValue != null && (
                <span className="font-mono text-[11px] text-text-muted">
                  {Math.max(1, Math.min(5, Math.round(numericValue <= 1 ? numericValue * 4 + 1 : numericValue)))}/5
                </span>
              )}
            </>
          ) : (
            <NumericSlider
              value={numericValue}
              min={config.min_value ?? 0}
              max={config.max_value ?? 1}
              onChange={setNumericValue}
            />
          )
        )}

        {config.data_type === 'CATEGORICAL' && (
          <CategoricalRating
            categories={config.categories ?? []}
            value={categoricalValue}
            onChange={setCategoricalValue}
          />
        )}

        {config.data_type === 'BOOLEAN' && (
          <BooleanRating
            value={booleanValue}
            onChange={setBooleanValue}
            trueLabel={config.bool_true_label ?? 'Pass'}
            falseLabel={config.bool_false_label ?? 'Fail'}
          />
        )}
      </div>

      {config.data_type === 'TEXT' && (
        <TextRating value={textValue} onChange={setTextValue} />
      )}

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
          disabled={save.isPending}
          className="font-mono text-[11.5px] px-3 py-[6px] rounded-[5px] bg-text text-bg font-medium hover:opacity-90 disabled:opacity-40"
        >
          {save.isPending ? 'Saving…' : isUpdate ? 'Update' : 'Save rating'}
        </button>
      </div>
    </div>
  )
}

function NumericSlider({
  value,
  min,
  max,
  onChange,
}: {
  value: number | null
  min: number
  max: number
  onChange: (v: number) => void
}) {
  return (
    <div className="flex items-center gap-2 min-w-[200px]">
      <input
        type="range"
        min={min}
        max={max}
        step={(max - min) / 100}
        value={value ?? (min + max) / 2}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1"
      />
      <span className="font-mono text-[11px] text-text-muted tabular-nums w-12 text-right">
        {value == null ? '—' : value.toFixed(2)}
      </span>
    </div>
  )
}

// ── Item card ───────────────────────────────────────────────────────────────

function ItemCard({
  item,
  focused,
  onFocus,
  activeConfig,
}: {
  item: AnnotationQueueItem
  focused: boolean
  onFocus: () => void
  activeConfig: ScoreConfig | null
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
              <span>You: {existingScoreLabel(item.human_eval, activeConfig)}</span>
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

      <ScoringPanel
        key={`${item.id}:${activeConfig?.id ?? 'noconfig'}`}
        item={item}
        config={activeConfig}
        onSaved={() => { /* react-query invalidation handles refresh */ }}
      />
    </div>
  )
}

// ── Main page ────────────────────────────────────────────────────────────────

export function AnnotationClient() {
  const router = useRouter()
  const sp = useSearchParams()
  const mounted = useMounted()

  const prompts = usePrompts()
  const scoreConfigs = useScoreConfigs()

  // URL-backed filters — shareable + survive reload.
  const promptName = sp.get('prompt') ?? ''
  const unscoredOnly = sp.get('unscored') === '1'
  const lowJudgeScoreOnly = sp.get('lowjudge') === '1'
  const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10))
  // Active score config is URL-backed too so a deep link onto someone
  // else's machine renders the right widget. Empty string = workspace
  // default (the first config returned by the API, sorted by
  // is_default DESC, created_at DESC).
  const configIdParam = sp.get('config') ?? ''

  const activeConfigList = useMemo(() => scoreConfigs.data ?? [], [scoreConfigs.data])
  const activeConfig = useMemo(() => {
    if (activeConfigList.length === 0) return null
    if (configIdParam) {
      const found = activeConfigList.find((c) => c.id === configIdParam)
      if (found) return found
    }
    return activeConfigList.find((c) => c.is_default) ?? activeConfigList[0] ?? null
  }, [activeConfigList, configIdParam])

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
  const judgeCount = items.filter((i) => i.llm_judge_score != null).length

  // Aggregate human scores by the active config's type. NUMERIC →
  // average. CATEGORICAL → top label + share. BOOLEAN → pass rate.
  // TEXT → sample count only.
  const aggregate = useMemo((): { label: string; value: string } => {
    if (!activeConfig) return { label: 'Avg human score', value: '—' }
    if (activeConfig.data_type === 'NUMERIC') {
      const values = items
        .map((i) => i.human_eval?.value_number ?? i.human_eval?.score)
        .filter((s): s is number => s != null)
      if (values.length === 0) return { label: 'Avg human score', value: '—' }
      const avg = values.reduce((a, b) => a + b, 0) / values.length
      return { label: 'Avg human score', value: fmtScore(avg) }
    }
    if (activeConfig.data_type === 'CATEGORICAL') {
      const counts = new Map<string, number>()
      for (const i of items) {
        const v = i.human_eval?.value_string
        if (v) counts.set(v, (counts.get(v) ?? 0) + 1)
      }
      if (counts.size === 0) return { label: 'Top category', value: '—' }
      let topLabel = ''
      let topCount = 0
      let total = 0
      counts.forEach((c, label) => {
        total += c
        if (c > topCount) { topCount = c; topLabel = label }
      })
      const share = total > 0 ? Math.round((topCount / total) * 100) : 0
      return { label: 'Top category', value: `${truncate(topLabel, 10)} ${share}%` }
    }
    if (activeConfig.data_type === 'BOOLEAN') {
      let pass = 0
      let total = 0
      for (const i of items) {
        const v = i.human_eval?.value_boolean
        if (v == null) continue
        total += 1
        if (v) pass += 1
      }
      if (total === 0) return { label: 'Pass rate', value: '—' }
      return { label: 'Pass rate', value: `${Math.round((pass / total) * 100)}%` }
    }
    // TEXT
    let textCount = 0
    for (const i of items) if (i.human_eval?.value_string != null) textCount += 1
    return { label: 'Notes captured', value: String(textCount) }
  }, [items, activeConfig])

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
        return
      }
      if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault()
        setFocusedIdx((i) => Math.max(0, i - 1))
        return
      }

      const target = pageItems[focusedIdx]
      if (!target || !activeConfig) return

      // Type-aware quick-rate shortcuts. Each branch validates the key
      // belongs to the current widget so a stray "y" doesn't confuse
      // a numeric workspace.
      if (activeConfig.data_type === 'NUMERIC' && ['1', '2', '3', '4', '5'].includes(e.key)) {
        const stars = Number(e.key)
        const min = activeConfig.min_value ?? 0
        const max = activeConfig.max_value ?? 1
        const isStarsLayout = min === 0 && max === 1
        const numeric = isStarsLayout ? (stars - 1) / 4 : Math.min(max, Math.max(min, stars))
        e.preventDefault()
        const payload: { requestId: string; scoreConfigId: string; value: number; rawScore?: number } = {
          requestId: target.id,
          scoreConfigId: activeConfig.id,
          value: numeric,
        }
        if (isStarsLayout) payload.rawScore = stars
        save.mutate(payload)
        return
      }
      if (activeConfig.data_type === 'CATEGORICAL') {
        const idx = ['1', '2', '3', '4', '5', '6', '7', '8', '9'].indexOf(e.key)
        const cats = activeConfig.categories ?? []
        if (idx >= 0 && idx < cats.length) {
          const chosen = cats[idx]
          if (chosen) {
            e.preventDefault()
            save.mutate({
              requestId: target.id,
              scoreConfigId: activeConfig.id,
              value: chosen,
            })
          }
        }
        return
      }
      if (activeConfig.data_type === 'BOOLEAN') {
        if (e.key === 'y' || e.key === 'Y' || e.key === 'p' || e.key === '1') {
          e.preventDefault()
          save.mutate({ requestId: target.id, scoreConfigId: activeConfig.id, value: true })
          return
        }
        if (e.key === 'n' || e.key === 'N' || e.key === 'f' || e.key === '0') {
          e.preventDefault()
          save.mutate({ requestId: target.id, scoreConfigId: activeConfig.id, value: false })
          return
        }
      }
      // TEXT has no quick-rate.
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [pageItems, focusedIdx, save, activeConfig])

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

      {/* Stat strip — Queue / Rated / Type-aware aggregate / Judge coverage.
          Aggregate label & value switch with the active config so a
          BOOLEAN workspace sees pass rate instead of a meaningless avg. */}
      <div className="shrink-0 border-b border-border">
        <div className="grid grid-cols-2 md:grid-cols-4">
          {[
            { label: 'In queue',       value: String(items.length) },
            { label: 'Rated by you',   value: String(scoredCount) },
            { label: aggregate.label,  value: aggregate.value },
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
        {activeConfigList.length > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-faint">
              Score config
            </span>
            <Select
              value={activeConfig?.id ?? ''}
              onValueChange={(v) => updateQuery({ config: v || null })}
            >
              <SelectTrigger className="w-auto h-7 rounded-[4px] text-[11.5px]">
                <SelectValue placeholder="Default" />
              </SelectTrigger>
              <SelectContent>
                {activeConfigList.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name} · {c.data_type.toLowerCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Link
              href="/settings/score-configs"
              className="font-mono text-[10.5px] text-text-faint hover:text-text-muted"
              title="Manage score configs"
            >
              ⚙
            </Link>
          </div>
        )}
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
                  activeConfig={activeConfig}
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
