'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Check, Copy, Play, RotateCw } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { cn, formatDateTime } from '@/lib/utils'
import { useRequest, useReplayRequest, useRunReplay } from '@/lib/queries/use-requests'
import { useModels, type ModelsByProvider } from '@/lib/queries/use-models'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ShareDialog } from '@/components/share/share-dialog'

// Payload design: docs/launch/2026-05-14_cache-stream-users.md §3.
import { capture } from '@/lib/posthog'
import { fmtCostSummary as fmtCost } from '@/lib/format'

type Tab = 'request' | 'response' | 'error'

export function RequestDetailClient({ id }: { id: string }) {
  const { data: req, isLoading, isError, refetch } = useRequest(id)
  // Parent passes `key={id}` so this component remounts on id change —
  // no setState-in-effect needed to reset the active tab.
  const [tab, setTab] = useState<Tab>('request')

  // Analytics: fire once per request when the cache breakdown card renders
  // (same condition as the card itself). Ref dedupes across refetches.
  const cacheCapturedRef = useRef(false)
  useEffect(() => {
    if (!req || cacheCapturedRef.current) return
    const cacheRead = req.cache_read_tokens ?? 0
    const cacheWrite = req.cache_write_tokens ?? 0
    if (cacheRead === 0 && cacheWrite === 0) return
    cacheCapturedRef.current = true
    capture({
      event: 'cache_breakdown_viewed',
      properties: {
        provider: req.provider,
        model: req.model,
        cache_hit_rate: req.prompt_tokens
          ? Number(((cacheRead / req.prompt_tokens) * 100).toFixed(1))
          : 0,
        cost_usd: req.cost_usd ?? 0,
      },
    })
  }, [req])

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-4 w-32" />
        <div className="flex items-start justify-between">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-6 w-16" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="border border-border rounded-[6px] px-4 py-3 bg-bg-elev">
              <Skeleton className="h-2.5 w-20 mb-2" />
              <Skeleton className="h-4 w-full" />
            </div>
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (isError || !req) {
    return (
      <div className="space-y-6">
        <Link href="/requests" className="inline-flex items-center gap-1.5 font-mono text-[12px] text-text-muted hover:text-text transition-colors">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to requests
        </Link>
        <div className="border border-border rounded-[6px] p-8 text-center bg-bg-elev">
          <p className="font-mono text-[13px] text-text mb-1.5">Request not found</p>
          <p className="font-mono text-[11.5px] text-text-faint mb-4">
            This request may have been deleted, or you may not have access to it.
          </p>
          <button
            onClick={() => void refetch()}
            className="font-mono text-[11.5px] text-accent hover:opacity-80 transition-opacity"
          >
            Try again
          </button>
        </div>
      </div>
    )
  }

  const isErr = req.status_code >= 400
  const tabs: Tab[] = ['request', 'response', ...(req.error_message ? ['error' as Tab] : [])]

  return (
    <div className="space-y-6">
      <Link href="/requests" className="inline-flex items-center gap-1.5 font-mono text-[12px] text-text-muted hover:text-text transition-colors">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to requests
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-mono text-[20px] font-medium text-text tracking-[-0.3px]">
            {req.id.slice(0, 8)}…
          </h1>
          <p className="font-mono text-[12px] text-text-muted mt-1">
            {formatDateTime(req.created_at)}
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <ShareDialog scope="request" targetId={req.id} variant="secondary" />
          <ReplayButton requestId={req.id} originalModel={req.model} provider={req.provider} />
          {req.truncated && (
            <span
              className="font-mono text-[11px] px-2 py-1 rounded border tracking-[0.04em] text-accent border-accent-border bg-accent-bg"
              title="Stream closed early because the request approached the Spanlens proxy deadline (~290s). Token counts and the response body reflect what was captured up to that point."
            >
              truncated
            </span>
          )}
          <span className={cn(
            'font-mono text-[11px] px-2 py-1 rounded border tracking-[0.04em]',
            isErr
              ? 'text-accent border-accent-border bg-accent-bg'
              : 'text-good border-border bg-bg-elev',
          )}>
            {req.status_code}
          </span>
        </div>
      </div>

      {/* Metrics grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Provider', value: req.provider_key_name ? `${req.provider} · ${req.provider_key_name}` : req.provider },
          { label: 'Model', value: req.model },
          { label: 'Latency', value: `${req.latency_ms} ms`, warn: req.latency_ms > 2000 },
          { label: 'Cost', value: fmtCost(req.cost_usd) },
          { label: 'Prompt tokens', value: req.prompt_tokens.toLocaleString() },
          { label: 'Completion tokens', value: req.completion_tokens.toLocaleString() },
          { label: 'Total tokens', value: req.total_tokens.toLocaleString() },
          { label: 'Trace ID', value: req.trace_id ? req.trace_id.slice(0, 16) + '…' : '—' },
        ].map(({ label, value, warn }) => (
          <div key={label} className="border border-border rounded-[6px] px-4 py-3 bg-bg-elev">
            <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-1.5">{label}</div>
            <div className={cn('font-mono text-[13px] font-medium truncate', warn ? 'text-accent' : 'text-text')}>{value}</div>
          </div>
        ))}
      </div>

      {/* End-user attribution row, only rendered when x-spanlens-user was set */}
      {req.user_id && (
        <div className="flex items-center gap-3 px-4 py-2 border border-border rounded-[6px] bg-bg-elev font-mono text-[12px]">
          <span className="text-[10px] uppercase tracking-[0.05em] text-text-faint">User</span>
          <Link
            href={`/users/${encodeURIComponent(req.user_id)}`}
            className="text-text hover:underline truncate"
          >
            {req.user_id}
          </Link>
          <Link
            href={`/requests?userId=${encodeURIComponent(req.user_id)}`}
            className="text-[10px] text-text-faint hover:text-text ml-auto"
          >
            filter requests →
          </Link>
        </div>
      )}

      {/* Prompt cache breakdown, only rendered when this request used caching */}
      {(req.cache_read_tokens ?? 0) > 0 || (req.cache_write_tokens ?? 0) > 0 ? (
        <div className="border border-border rounded-[6px] bg-bg-elev px-4 py-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-2">
            Prompt cache breakdown
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2 font-mono text-[12px] text-text">
            <div>
              <span className="text-text-faint">Cache read</span>{' '}
              <span className="font-medium">{(req.cache_read_tokens ?? 0).toLocaleString()}</span>
              <span className="text-text-faint"> tokens</span>
            </div>
            <div>
              <span className="text-text-faint">Cache write</span>{' '}
              <span className="font-medium">{(req.cache_write_tokens ?? 0).toLocaleString()}</span>
              <span className="text-text-faint"> tokens</span>
            </div>
            <div>
              <span className="text-text-faint">Non-cached input</span>{' '}
              <span className="font-medium">
                {Math.max(
                  0,
                  req.prompt_tokens - (req.cache_read_tokens ?? 0) - (req.cache_write_tokens ?? 0),
                ).toLocaleString()}
              </span>
              <span className="text-text-faint"> tokens</span>
            </div>
            <div>
              <span className="text-text-faint">Cache hit rate</span>{' '}
              <span className="font-medium">
                {req.prompt_tokens > 0
                  ? `${(((req.cache_read_tokens ?? 0) / req.prompt_tokens) * 100).toFixed(1)}%`
                  : '—'}
              </span>
            </div>
          </div>
        </div>
      ) : null}

      {/* Body tabs */}
      <div>
        <div className="flex border-b border-border gap-5 mb-0">
          {tabs.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'py-2 font-mono text-[11px] uppercase tracking-[0.04em] border-b-[1.5px] -mb-px transition-colors',
                tab === t ? 'text-text border-accent' : 'text-text-muted border-transparent hover:text-text',
              )}
            >
              {t === 'request' ? 'Request body' : t === 'response' ? 'Response body' : 'Error'}
            </button>
          ))}
        </div>

        <div className="mt-3 rounded-[6px] border border-border bg-bg-elev overflow-auto max-h-[480px]">
          {tab === 'request' && (
            <pre className="p-4 font-mono text-[12px] text-text leading-relaxed whitespace-pre-wrap break-all">
              {req.request_body ? JSON.stringify(req.request_body, null, 2) : '(no body)'}
            </pre>
          )}
          {tab === 'response' && (
            <pre className="p-4 font-mono text-[12px] text-text leading-relaxed whitespace-pre-wrap break-all">
              {req.response_body ? JSON.stringify(req.response_body, null, 2) : '(not stored)'}
            </pre>
          )}
          {tab === 'error' && req.error_message && (
            <pre className="p-4 font-mono text-[12px] text-bad leading-relaxed whitespace-pre-wrap break-all">
              {req.error_message}
            </pre>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Replay button + dialog ─────────────────────────────────────────────

/** Pull provider model strings out of the live catalog. */
function modelsForProvider(
  catalog: ModelsByProvider | undefined,
  provider: string,
): string[] {
  if (!catalog) return []
  const key = provider as keyof ModelsByProvider
  return (catalog[key] ?? []).map((m) => m.model)
}

function buildCurlSnippet(proxyPath: string, body: Record<string, unknown>): string {
  const prettyBody = JSON.stringify(body, null, 2)
  return [
    `curl -X POST 'https://www.spanlens.io${proxyPath}' \\`,
    `  -H 'Authorization: Bearer <YOUR_SPANLENS_API_KEY>' \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -d '${prettyBody}'`,
  ].join('\n')
}

interface ReplayButtonProps {
  requestId: string
  originalModel: string
  provider: string
}

function ReplayButton({ requestId, originalModel, provider }: ReplayButtonProps) {
  const [open, setOpen] = useState(false)
  const [model, setModel] = useState(originalModel)
  const [copiedCurl, setCopiedCurl] = useState(false)

  const prepare = useReplayRequest()
  const run = useRunReplay()
  const { data: modelsCatalog } = useModels()

  // Scroll the result card into view once per completed replay. Keyed on the
  // mutation result identity, which only changes when a new replay resolves,
  // so unrelated re-renders (e.g. a useModels refetch on window focus) never
  // re-trigger the scroll and yank the viewport. No setState here, so this
  // stays clear of the react-hooks/set-state-in-effect rule.
  const resultRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (run.data) {
      resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [run.data])

  // Model options: provider list from the live catalog + original if not
  // already included. Falls back to just the original while the catalog
  // is loading so the dropdown isn't empty.
  const providerModels = modelsForProvider(modelsCatalog, provider)
  const modelOptions = providerModels.length === 0
    ? [originalModel]
    : providerModels.includes(originalModel)
      ? providerModels
      : [originalModel, ...providerModels]

  function reset(): void {
    setModel(originalModel)
    setCopiedCurl(false)
    prepare.reset()
    run.reset()
  }

  function handleClose(): void {
    setOpen(false)
    reset()
  }

  async function handleRun(): Promise<void> {
    prepare.reset()
    await run.mutateAsync({ id: requestId, ...(model !== originalModel ? { model } : {}) })
  }

  async function handleCopyCurl(): Promise<void> {
    run.reset()
    const result = await prepare.mutateAsync({
      id: requestId,
      ...(model !== originalModel ? { model } : {}),
    })
    const snippet = buildCurlSnippet(result.proxyPath, result.replayBody)
    await navigator.clipboard.writeText(snippet)
    setCopiedCurl(true)
    setTimeout(() => setCopiedCurl(false), 1800)
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 font-mono text-[11.5px] px-3 py-1.5 border border-border rounded-[5px] text-text-muted hover:border-border-strong hover:text-text transition-colors"
      >
        <RotateCw className="h-3 w-3" />
        Replay
      </button>
    )
  }

  const isLoading = run.isPending || prepare.isPending
  const anyError = run.isError || prepare.isError
  const errorMsg = run.isError
    ? (run.error instanceof Error ? run.error.message : 'Run failed')
    : prepare.isError
      ? (prepare.error instanceof Error ? prepare.error.message : 'Failed to prepare curl')
      : null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={handleClose}
    >
      <div
        className="w-[580px] bg-bg border border-border rounded-[8px] shadow-xl p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="font-mono text-[14px] font-medium text-text">Replay request</h2>
          <button
            onClick={handleClose}
            className="font-mono text-[10px] text-text-faint hover:text-text transition-colors px-1.5 py-0.5 border border-border rounded uppercase tracking-[0.04em]"
          >
            Close
          </button>
        </div>

        {/* Model selector */}
        <div className="space-y-1.5">
          <label className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">
            Model
          </label>
          <Select value={model} onValueChange={(v) => { setModel(v); prepare.reset(); run.reset() }}>
            <SelectTrigger className="h-auto py-2 text-[12.5px] pl-3 bg-bg-elev transition-colors">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {modelOptions.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}{m === originalModel ? ' (original)' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="font-mono text-[10.5px] text-text-faint">
            Swap model to compare cost / latency, or keep original.
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => void handleRun()}
            disabled={isLoading}
            className="inline-flex items-center gap-1.5 font-mono text-[11.5px] px-4 py-2 rounded-[5px] bg-accent text-white hover:opacity-90 transition-opacity disabled:opacity-40"
          >
            <Play className="h-3 w-3 fill-current" />
            {run.isPending ? 'Running…' : 'Run'}
          </button>
          <button
            onClick={() => void handleCopyCurl()}
            disabled={isLoading}
            className="inline-flex items-center gap-1.5 font-mono text-[11.5px] px-3 py-2 border border-border rounded-[5px] text-text-muted hover:border-border-strong hover:text-text transition-colors disabled:opacity-40"
          >
            {copiedCurl ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {prepare.isPending ? 'Preparing…' : copiedCurl ? 'Copied!' : 'Copy curl'}
          </button>
        </div>

        {/* Run result card. A mount-only effect above scrolls it into view
            when a replay completes so the outcome is surfaced even on short
            viewports. */}
        {run.data && (
          <div
            ref={resultRef}
            className="rounded-[6px] border border-border bg-bg-elev px-4 py-3 space-y-3"
          >
            <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">
              {run.data.statusCode < 400 ? 'Replay complete' : 'Replay finished with errors'} · HTTP {run.data.statusCode}
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2">
              {[
                { label: 'Latency', value: `${run.data.latencyMs} ms` },
                { label: 'Cost', value: fmtCost(run.data.costUsd) },
                { label: 'Prompt tokens', value: run.data.promptTokens.toLocaleString() },
                { label: 'Completion tokens', value: run.data.completionTokens.toLocaleString() },
                { label: 'Total tokens', value: run.data.totalTokens.toLocaleString() },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-center justify-between">
                  <span className="font-mono text-[11px] text-text-faint">{label}</span>
                  <span className="font-mono text-[12px] font-medium text-text">{value}</span>
                </div>
              ))}
            </div>
            <p className="font-mono text-[10.5px] text-text-faint">
              Logged as a new request ·{' '}
              <Link
                href="/requests"
                className="text-text hover:underline underline-offset-2"
              >
                View in /requests →
              </Link>
            </p>
          </div>
        )}

        {/* Curl snippet (shown after "Copy curl" flow) */}
        {prepare.data && !copiedCurl && (
          <div className="rounded-[5px] border border-border bg-bg-elev p-3 overflow-auto max-h-[180px]">
            <pre className="font-mono text-[11px] text-text leading-relaxed whitespace-pre-wrap break-all">
              {buildCurlSnippet(prepare.data.proxyPath, prepare.data.replayBody)}
            </pre>
          </div>
        )}

        {/* Error */}
        {anyError && errorMsg && (
          <p className="font-mono text-[12px] text-bad">{errorMsg}</p>
        )}
      </div>
    </div>
  )
}
