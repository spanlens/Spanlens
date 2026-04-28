'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Check, Copy, RotateCw } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { useRequest, useReplayRequest } from '@/lib/queries/use-requests'

function fmtCost(n: number | null): string {
  if (n == null) return '—'
  return '$' + n.toFixed(6)
}

type Tab = 'request' | 'response' | 'error'

export default function RequestDetailPage({ params }: { params: { id: string } }) {
  const { data: req, isLoading, isError, refetch } = useRequest(params.id)
  const [tab, setTab] = useState<Tab>('request')

  useEffect(() => { setTab('request') }, [params.id])

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
            {new Date(req.created_at).toLocaleString()}
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <ReplayButton requestId={req.id} originalModel={req.model} />
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

interface ReplayButtonProps {
  requestId: string
  originalModel: string
}

function ReplayButton({ requestId, originalModel }: ReplayButtonProps) {
  const [open, setOpen] = useState(false)
  const [model, setModel] = useState(originalModel)
  const [copied, setCopied] = useState(false)
  const replay = useReplayRequest()
  const result = replay.data

  async function handlePrepare(): Promise<void> {
    const trimmed = model.trim()
    await replay.mutateAsync(trimmed ? { id: requestId, model: trimmed } : { id: requestId })
  }

  function reset(): void {
    setModel(originalModel)
    setCopied(false)
    replay.reset()
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => { setOpen(false); reset() }}>
      <div
        className="w-[560px] bg-bg border border-border rounded-[8px] shadow-xl p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-mono text-[14px] font-medium text-text">Replay request</h2>
          <button onClick={() => { setOpen(false); reset() }} className="font-mono text-[10px] text-text-faint hover:text-text transition-colors px-1.5 py-0.5 border border-border rounded uppercase tracking-[0.04em]">
            Close
          </button>
        </div>

        <div className="space-y-1.5">
          <label className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint">Model override</label>
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={originalModel}
            className="w-full font-mono text-[12.5px] border border-border rounded-[5px] px-3 py-2 bg-bg-elev text-text placeholder:text-text-faint focus:outline-none focus:border-border-strong transition-colors"
          />
          <p className="font-mono text-[10.5px] text-text-faint">
            Leave as-is or swap to a different model to compare cost/latency.
          </p>
        </div>

        {!result ? (
          <button
            onClick={() => void handlePrepare()}
            disabled={replay.isPending}
            className="w-full font-mono text-[12px] py-2 border border-border rounded-[5px] text-text-muted hover:border-border-strong hover:text-text transition-colors disabled:opacity-40"
          >
            {replay.isPending ? 'Preparing…' : 'Prepare replay snippet'}
          </button>
        ) : (
          <div className="space-y-3">
            <div className="rounded-[5px] border border-border bg-bg-elev p-3 overflow-auto max-h-[200px]">
              <pre className="font-mono text-[11.5px] text-text leading-relaxed whitespace-pre-wrap break-all">
                {`curl -X POST 'https://www.spanlens.io${result.proxyPath}' \\\n  -H 'Authorization: Bearer <YOUR_SPANLENS_API_KEY>' \\\n  -H 'Content-Type: application/json' \\\n  -d '${JSON.stringify(result.replayBody)}'`}
              </pre>
            </div>
            <div className="flex items-center gap-2.5">
              <button
                onClick={() => {
                  const cmd = `curl -X POST 'https://www.spanlens.io${result.proxyPath}' \\\n  -H 'Authorization: Bearer <YOUR_SPANLENS_API_KEY>' \\\n  -H 'Content-Type: application/json' \\\n  -d '${JSON.stringify(result.replayBody)}'`
                  void navigator.clipboard.writeText(cmd)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1500)
                }}
                className="inline-flex items-center gap-1.5 font-mono text-[11.5px] px-3 py-1.5 border border-border rounded-[5px] text-text-muted hover:border-border-strong hover:text-text transition-colors"
              >
                {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {copied ? 'Copied' : 'Copy curl'}
              </button>
              <p className="font-mono text-[10.5px] text-text-faint">
                Runs through /proxy, counts toward quota and shows in /requests.
              </p>
            </div>
          </div>
        )}

        {replay.isError && (
          <p className="font-mono text-[12px] text-bad">
            {replay.error instanceof Error ? replay.error.message : 'Failed to prepare replay'}
          </p>
        )}
      </div>
    </div>
  )
}
