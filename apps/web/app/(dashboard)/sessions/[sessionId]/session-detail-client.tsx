'use client'

import { useMemo, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'
import { ArrowLeft, Copy, Check, ChevronDown, ChevronRight } from 'lucide-react'
import { useSession } from '@/lib/queries/use-sessions'
import type { SessionTurn } from '@/lib/queries/types'
import { Skeleton } from '@/components/ui/skeleton'
import { cn, formatDateTime } from '@/lib/utils'
import { Topbar } from '@/components/layout/topbar'

const subscribeNoop = () => () => {}
const getTrue = () => true
const getFalse = () => false
function useMounted(): boolean {
  return useSyncExternalStore(subscribeNoop, getTrue, getFalse)
}

type TimeRange = '24h' | '7d' | '30d' | 'all'

function fmtCost(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n === 0) return '$0.00'
  return n < 0.01 ? '< $0.01' : '$' + n.toFixed(4)
}

function fmtDurationMs(ms: number | null | undefined): string {
  if (ms == null) return '—'
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`
}

// Anthropic sends content as [{type:'text',text:'...'}], OpenAI as a string.
function extractMessageText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === 'object' && block !== null) {
          const b = block as Record<string, unknown>
          if (typeof b.text === 'string') return b.text
          if (b.type === 'image' || b.type === 'image_url') return '[image]'
          if (b.type === 'tool_use') return `[tool_use: ${String(b.name ?? '')}]`
          if (b.type === 'tool_result') return '[tool_result]'
        }
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
  return ''
}

interface ChatMessage {
  role: string
  content: string
}

// Pull the chat messages out of a request body across providers.
function messagesFromBody(body: unknown): ChatMessage[] {
  if (!body || typeof body !== 'object') return []
  const b = body as Record<string, unknown>
  const out: ChatMessage[] = []

  // Anthropic system is top-level
  if (typeof b.system === 'string' && b.system.trim()) {
    out.push({ role: 'system', content: b.system })
  }

  // OpenAI / Anthropic: messages[]
  if (Array.isArray(b.messages)) {
    for (const m of b.messages as unknown[]) {
      if (typeof m === 'object' && m !== null) {
        const mm = m as Record<string, unknown>
        if (typeof mm.role === 'string') {
          out.push({ role: mm.role, content: extractMessageText(mm.content) })
        }
      }
    }
    return out
  }

  // Gemini: contents[].parts[].text
  if (Array.isArray(b.contents)) {
    for (const m of b.contents as unknown[]) {
      if (typeof m === 'object' && m !== null) {
        const mm = m as Record<string, unknown>
        const role = mm.role === 'model' ? 'assistant' : (typeof mm.role === 'string' ? mm.role : 'user')
        const parts = Array.isArray(mm.parts) ? (mm.parts as Array<{ text?: string }>) : []
        const content = parts.filter((p) => typeof p.text === 'string').map((p) => p.text as string).join('')
        out.push({ role, content })
      }
    }
  }
  return out
}

// Extract the assistant's reply text from a response body across providers.
function assistantTextFromResponse(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>

  // OpenAI: choices[0].message.content
  if (Array.isArray(b.choices)) {
    const first = b.choices[0] as Record<string, unknown> | undefined
    const msg = first?.message as Record<string, unknown> | undefined
    if (msg && 'content' in msg) {
      const text = extractMessageText(msg.content)
      if (text) return text
    }
  }

  // Anthropic: content[]
  if (Array.isArray(b.content)) {
    const text = extractMessageText(b.content)
    if (text) return text
  }

  // Gemini: candidates[0].content.parts[].text
  if (Array.isArray(b.candidates)) {
    const cand = b.candidates[0] as Record<string, unknown> | undefined
    const content = cand?.content as Record<string, unknown> | undefined
    const parts = Array.isArray(content?.parts) ? (content!.parts as Array<{ text?: string }>) : []
    const text = parts.filter((p) => typeof p.text === 'string').map((p) => p.text as string).join('')
    if (text) return text
  }
  return null
}

function CopyIdButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(value)
        setCopied(true)
        setTimeout(() => setCopied(false), 1200)
      }}
      aria-label="Copy session ID"
      className="p-1 rounded hover:bg-bg-elev text-text-faint hover:text-text transition-colors"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-good" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  )
}

function MessageBubble({ role, content }: ChatMessage) {
  const isAssistant = role === 'assistant'
  const isSystem = role === 'system'
  return (
    <div>
      <div className="font-mono text-[10px] text-text-faint tracking-[0.04em] mb-1">{role}</div>
      <div className={cn(
        'px-3 py-2.5 rounded-[5px] border font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap break-words',
        isSystem ? 'bg-bg-muted border-border text-text-faint'
          : isAssistant ? 'bg-bg-elev border-border-strong text-text'
          : 'bg-bg-muted border-border text-text-muted',
      )}>
        {content || <span className="text-text-faint italic">empty</span>}
      </div>
    </div>
  )
}

function TurnCard({ turn, index }: { turn: SessionTurn; index: number }) {
  const isErr = turn.status_code >= 400
  // The last user message is the most relevant prompt for this turn; show it
  // collapsed by default, with the full message list expandable.
  const messages = useMemo(() => messagesFromBody(turn.request_body), [turn.request_body])
  const lastUser = useMemo(
    () => [...messages].reverse().find((m) => m.role === 'user') ?? null,
    [messages],
  )
  const assistantText = useMemo(
    () => assistantTextFromResponse(turn.response_body),
    [turn.response_body],
  )
  const [expanded, setExpanded] = useState(false)

  return (
    <div className={cn(
      'border rounded-[8px] overflow-hidden',
      isErr ? 'border-bad/30 bg-bad-bg' : 'border-border bg-bg',
    )}>
      {/* Turn header */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-bg-elev transition-colors"
      >
        <span className="font-mono text-[10px] text-text-faint w-7 shrink-0">#{index + 1}</span>
        {expanded ? <ChevronDown className="h-3.5 w-3.5 text-text-faint shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-text-faint shrink-0" />}
        <span className="font-mono text-[12px] text-text truncate flex-1">{turn.model}</span>
        {isErr && (
          <span className="font-mono text-[9.5px] px-1.5 py-0.5 rounded bg-bad-bg text-bad border border-bad/20 uppercase tracking-[0.04em] shrink-0">
            {turn.status_code}
          </span>
        )}
        <span className="font-mono text-[10.5px] text-text-muted shrink-0">{turn.total_tokens.toLocaleString()} tok</span>
        <span className="font-mono text-[10.5px] text-text-muted shrink-0 hidden sm:inline">{fmtCost(turn.cost_usd)}</span>
        <span className="font-mono text-[10.5px] text-text-faint shrink-0 hidden sm:inline">{fmtDurationMs(turn.latency_ms)}</span>
        <span className="font-mono text-[10px] text-text-faint shrink-0" title={formatDateTime(turn.created_at)}>
          {new Date(turn.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </span>
      </button>

      {/* Collapsed preview: last user prompt + assistant reply snippet */}
      {!expanded && (
        <div className="px-4 pb-3 space-y-2">
          {lastUser && (
            <p className="font-mono text-[11.5px] text-text-muted line-clamp-2 break-words">
              <span className="text-text-faint">user: </span>{lastUser.content}
            </p>
          )}
          {assistantText && (
            <p className="font-mono text-[11.5px] text-text line-clamp-2 break-words">
              <span className="text-text-faint">assistant: </span>{assistantText}
            </p>
          )}
          {turn.error_message && (
            <p className="font-mono text-[11px] text-bad line-clamp-2 break-words">{turn.error_message}</p>
          )}
        </div>
      )}

      {/* Expanded: full message list + assistant response + links */}
      {expanded && (
        <div className="px-4 pb-4 pt-1 space-y-3 border-t border-border">
          {messages.length === 0 && !assistantText && (
            <p className="font-mono text-[11.5px] text-text-faint">
              Message bodies were not captured for this turn (log mode meta/none, or response not stored).
            </p>
          )}
          {messages.map((m, i) => <MessageBubble key={i} {...m} />)}
          {assistantText && <MessageBubble role="assistant" content={assistantText} />}
          {turn.error_message && (
            <div>
              <div className="font-mono text-[10px] text-bad tracking-[0.04em] mb-1">error</div>
              <pre className="font-mono text-[11.5px] text-bad leading-relaxed whitespace-pre-wrap break-all bg-bad-bg border border-bad/20 rounded p-3">
                {turn.error_message}
              </pre>
            </div>
          )}
          <div className="flex items-center gap-4 pt-1">
            <Link href={`/requests/${turn.id}`} className="font-mono text-[11px] text-accent hover:opacity-80 transition-opacity">
              Open request →
            </Link>
            {turn.trace_id && (
              <Link href={`/traces/${turn.trace_id}`} className="font-mono text-[11px] text-accent hover:opacity-80 transition-opacity">
                Open trace →
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export function SessionDetailClient() {
  const params = useParams<{ sessionId: string }>()
  const sessionId = decodeURIComponent(params.sessionId)
  const sp = useSearchParams()
  const mounted = useMounted()

  const rangeParam = (sp.get('range') ?? 'all') as TimeRange
  const [mountNow] = useState(() => Date.now())

  const fromIso = useMemo(() => {
    if (rangeParam === 'all') return undefined
    const hours = rangeParam === '24h' ? 24 : rangeParam === '7d' ? 24 * 7 : 24 * 30
    return new Date(mountNow - hours * 3_600_000).toISOString()
  }, [rangeParam, mountNow])

  const { data: s, isLoading, isError } = useSession(sessionId, fromIso ? { from: fromIso } : {})

  const stats = useMemo(() => {
    if (!s) return []
    return [
      { label: 'Turns', value: s.total_requests.toLocaleString() },
      { label: 'Total tokens', value: s.total_tokens.toLocaleString() },
      { label: 'Total cost', value: fmtCost(s.total_cost_usd) },
      { label: 'Avg latency', value: s.avg_latency_ms != null ? `${Math.round(s.avg_latency_ms)}ms` : '—' },
      { label: 'Errors', value: String(s.error_requests) },
      { label: 'Models', value: String(s.distinct_models) },
    ]
  }, [s])

  return (
    <div className="-mx-4 -my-4 md:-mx-8 md:-my-7 flex flex-col min-h-screen">
      <div className="sticky top-0 z-20 bg-bg">
        <Topbar crumbs={[{ label: 'Sessions', href: '/sessions' }, { label: sessionId }]} />
      </div>

      <div className="flex flex-col gap-6 px-[22px] py-[22px] max-w-4xl w-full">
        {/* Back + title */}
        <div className="flex items-center gap-3 flex-wrap">
          <Link
            href="/sessions"
            className="inline-flex items-center gap-1 font-mono text-[11px] text-text-faint hover:text-text transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Sessions
          </Link>
        </div>

        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h1 className="font-mono text-[15px] text-text truncate">{sessionId}</h1>
              <CopyIdButton value={sessionId} />
            </div>
            {s?.user_id && (
              <p className="font-mono text-[11.5px] text-text-faint mt-1.5">
                user:{' '}
                <Link href={`/users/${encodeURIComponent(s.user_id)}`} className="text-text hover:underline">
                  {s.user_id}
                </Link>
              </p>
            )}
          </div>
        </div>

        {/* Stat grid */}
        <div className="grid grid-cols-3 sm:grid-cols-6 border border-border rounded-[6px] overflow-hidden">
          {(!mounted || isLoading ? Array.from({ length: 6 }).map((_, i) => ({ label: '', value: '', _i: i })) : stats).map((st, i) => (
            <div key={i} className={cn('px-3.5 py-3', i < 5 && 'border-r border-border', 'border-b sm:border-b-0 border-border')}>
              <div className="font-mono text-[9.5px] uppercase tracking-[0.05em] text-text-faint mb-1.5">
                {(!mounted || isLoading) ? <Skeleton className="h-2.5 w-12" /> : st.label}
              </div>
              <div className="text-[18px] font-medium tracking-[-0.3px] leading-none text-text">
                {(!mounted || isLoading) ? <Skeleton className="h-4 w-10" /> : st.value}
              </div>
            </div>
          ))}
        </div>

        {/* Conversation timeline */}
        <div>
          <h2 className="font-mono text-[11px] uppercase tracking-[0.05em] text-text-faint mb-3">Conversation</h2>

          {mounted && !isLoading && isError && (
            <p className="font-mono text-[12px] text-text-muted py-8 text-center">Failed to load session.</p>
          )}

          {(!mounted || isLoading) && (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full rounded-[8px]" />)}
            </div>
          )}

          {mounted && !isLoading && !isError && s && s.turns.length === 0 && (
            <p className="font-mono text-[12px] text-text-faint py-8 text-center">
              No turns found for this session in the selected window.
            </p>
          )}

          {mounted && !isLoading && !isError && s && s.turns.length > 0 && (
            <div className="space-y-2.5">
              {s.turns.map((t, i) => <TurnCard key={t.id} turn={t} index={i} />)}
              {s.turns_truncated && (
                <p className="font-mono text-[11px] text-text-faint text-center pt-2">
                  Showing the first {s.turns.length} turns. Older turns in this session are not displayed.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
