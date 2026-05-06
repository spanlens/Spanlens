'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Check, Copy, Play, RotateCw } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { useRequest, useReplayRequest, useRunReplay } from '@/lib/queries/use-requests'

function fmtCost(n: number | null): string {
  if (n == null) return '—'
  return '$' + n.toFixed(6)
}

type Tab = 'request' | 'response' | 'error'

export function RequestDetailClient({ id }: { id: string }) {
  const { data: req, isLoading, isError, refetch } = useRequest(id)
  const [tab, setTab] = useState<Tab>('request')

  useEffect(() => { setTab('request') }, [id])

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
          <p suppressHydrationWarning className="font-mono text-[12px] text-text-muted mt-1">
            {new Date(req.created_at).toLocaleString()}
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <ReplayButton requestId={req.id} originalModel={req.model} provider={req.provider} />
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

const MODELS_BY_PROVIDER: Record<string, string[]> = {
  openai: [
    'gpt-4o',
    'gpt-4o-mini',
    'o1',
    'o1-mini',
    'o3-mini',
    'gpt-4-turbo',
    'gpt-3.5-turbo',
  ],
  anthropic: [
    'claude-opus-4-5',
    'claude-sonnet-4-5',
    'claude-haiku-3-5',
    'claude-3-5-sonnet-20241022',
    'claude-3-5-haiku-20241022',
    'claude-3-opus-20240229',
  ],
  gemini: [
    'gemini-2.0-flash',
    'gemini-2.0-flash-exp',
    'gemini-1.5-pro',
    'gemini-1.5-flash',
    'gemini-1.5-flash-8b',
  ],
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

  // Model options: provider list + original if not already included
  const providerModels = MODELS_BY_PROVIDER[provider] ?? []
  const modelOptions = providerModels.includes(originalModel)
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
          <select
            value={model}
            onChange={(e) => { setModel(e.target.value); prepare.reset(); run.reset() }}
            className="w-full font-mono text-[12.5px] border border-border rounded-[5px] px-3 py-2 bg-bg-elev text-text focus:outline-none focus:border-border-strong transition-colors appearance-none cursor-pointer"
          >
            {modelOptions.map((m) => (
              <option key={m} value={m}>
                {m}{m === originalModel ? ' (original)' : ''}
              </option>
            ))}
          </select>
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

        {/* Run result card */}
        {run.data && (
          <div className="rounded-[6px] border border-border bg-bg-elev px-4 py-3 space-y-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">
              Result · HTTP {run.data.statusCode}
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2">
              {[
                { label: 'Latency', value: `${run.data.latencyMs} ms` },
                { label: 'Cost', value: run.data.costUsd != null ? `$${run.data.costUsd.toFixed(6)}` : '—' },
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
