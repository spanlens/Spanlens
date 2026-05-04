'use client'
import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import { DEMO_REQUEST_DETAILS } from '@/lib/demo-data'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtCost(n: number | null): string {
  if (n == null) return '—'
  return '$' + n.toFixed(6)
}

// ── CopyButton ────────────────────────────────────────────────────────────────

function CopyButton({ getText }: { getText: () => string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => {
        void navigator.clipboard.writeText(getText())
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
      className="font-mono text-[10px] px-1.5 py-0.5 border border-border rounded text-text-faint hover:text-text hover:border-border-strong transition-colors shrink-0"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

type Tab = 'request' | 'response' | 'error'

export default function DemoRequestDetailPage({ params }: { params: { id: string } }) {
  const req = DEMO_REQUEST_DETAILS[params.id] ?? null
  const [tab, setTab] = useState<Tab>('request')

  if (!req) {
    return (
      <div className="space-y-6">
        <Link
          href="/demo/requests"
          className="inline-flex items-center gap-1.5 font-mono text-[12px] text-text-muted hover:text-text transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to requests
        </Link>
        <div className="border border-border rounded-[6px] p-8 text-center bg-bg-elev">
          <p className="font-mono text-[13px] text-text mb-1.5">Request not found</p>
          <p className="font-mono text-[11.5px] text-text-faint mb-4">
            This request ID does not exist in the demo dataset.
          </p>
          <Link
            href="/demo/requests"
            className="font-mono text-[11.5px] text-accent hover:opacity-80 transition-opacity"
          >
            ← Back to requests
          </Link>
        </div>
      </div>
    )
  }

  const isErr = req.status_code >= 400
  const tabs: Tab[] = ['request', 'response', ...(req.error_message ? ['error' as Tab] : [])]

  interface MetaItem {
    label: string
    value: string
    warn?: boolean
    link?: string
  }

  const metaItems: MetaItem[] = [
    {
      label: 'Provider',
      value: req.provider_key_name
        ? `${req.provider} · ${req.provider_key_name}`
        : req.provider,
    },
    { label: 'Model', value: req.model },
    { label: 'Latency', value: `${req.latency_ms} ms`, warn: req.latency_ms > 2000 },
    { label: 'Cost', value: fmtCost(req.cost_usd) },
    { label: 'Prompt tokens', value: req.prompt_tokens.toLocaleString() },
    { label: 'Completion tokens', value: req.completion_tokens.toLocaleString() },
    { label: 'Total tokens', value: req.total_tokens.toLocaleString() },
    ...(req.trace_id
      ? [{ label: 'Trace ID', value: req.trace_id.slice(0, 16) + '…', link: `/demo/traces/${req.trace_id}` }]
      : [{ label: 'Trace ID', value: '—' }]),
    { label: 'Status', value: String(req.status_code), warn: isErr },
  ]

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link
        href="/demo/requests"
        className="inline-flex items-center gap-1.5 font-mono text-[12px] text-text-muted hover:text-text transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to requests
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-mono text-[20px] font-medium text-text tracking-[-0.3px]">
            {req.id.startsWith('req-') ? req.id : req.id.slice(0, 8) + '…'}
          </h1>
          <p className="font-mono text-[12px] text-text-muted mt-1">
            {new Date(req.created_at).toLocaleString()}
          </p>
        </div>
        <span
          className={cn(
            'font-mono text-[11px] px-2 py-1 rounded border tracking-[0.04em] shrink-0',
            isErr
              ? 'text-accent border-accent-border bg-accent-bg'
              : 'text-good border-border bg-bg-elev',
          )}
        >
          {req.status_code}
        </span>
      </div>

      {/* Metrics grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {metaItems.map(({ label, value, warn, link }) => (
          <div key={label} className="border border-border rounded-[6px] px-4 py-3 bg-bg-elev">
            <div className="font-mono text-[10px] uppercase tracking-[0.05em] text-text-faint mb-1.5">
              {label}
            </div>
            {link ? (
              <Link
                href={link}
                className="font-mono text-[13px] font-medium truncate block text-accent hover:opacity-80 transition-opacity"
              >
                {value}
              </Link>
            ) : (
              <div
                className={cn(
                  'font-mono text-[13px] font-medium truncate',
                  warn ? 'text-accent' : 'text-text',
                )}
              >
                {value}
              </div>
            )}
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
                tab === t
                  ? 'text-text border-accent'
                  : 'text-text-muted border-transparent hover:text-text',
                t === 'error' && tab !== 'error' && 'text-bad',
              )}
            >
              {t === 'request' ? 'Request body' : t === 'response' ? 'Response body' : 'Error'}
            </button>
          ))}
        </div>

        <div className="mt-3 rounded-[6px] border border-border bg-bg-elev overflow-hidden">
          {/* Copy button */}
          <div className="flex justify-end px-3 pt-2">
            {tab === 'request' && req.request_body != null && (
              <CopyButton getText={() => JSON.stringify(req.request_body as Record<string, unknown>, null, 2)} />
            )}
            {tab === 'response' && req.response_body != null && (
              <CopyButton getText={() => JSON.stringify(req.response_body as Record<string, unknown>, null, 2)} />
            )}
            {tab === 'error' && req.error_message && (
              <CopyButton getText={() => req.error_message ?? ''} />
            )}
          </div>

          <div className="overflow-auto max-h-[480px]">
            {tab === 'request' && (
              <pre className="p-4 font-mono text-[12px] text-text leading-relaxed whitespace-pre-wrap break-all">
                {req.request_body ? JSON.stringify(req.request_body, null, 2) : '(no body)'}
              </pre>
            )}
            {tab === 'response' && (
              <pre className="p-4 font-mono text-[12px] text-text leading-relaxed whitespace-pre-wrap break-all">
                {req.response_body
                  ? JSON.stringify(req.response_body, null, 2)
                  : '(not stored)'}
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
    </div>
  )
}
