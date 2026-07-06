'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Copy, Check, Terminal } from 'lucide-react'

/**
 * First-run hint shown in the traces table when the account has no traces
 * yet (and no filters are hiding them). Unlike requests, traces don't come
 * for free from the proxy — they need SDK instrumentation — so this gives
 * the minimal startTrace / observe snippet; the trace list polls on its
 * own, so the row appears here automatically once the first trace lands.
 */
const TRACE_SNIPPET = `import { SpanlensClient, observe } from '@spanlens/sdk'

const client = new SpanlensClient({ apiKey: process.env.SPANLENS_API_KEY! })

const trace = client.startTrace({ name: 'my_workflow' })
await observe(trace, { name: 'llm_step', spanType: 'llm' }, async (span) => {
  // your LLM call here
})
await trace.end({ status: 'completed' })`

export function EmptyTracesHint() {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(TRACE_SNIPPET)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="flex flex-col items-center gap-3 max-w-xl w-full">
      <span className="text-[13px] text-text-muted">
        No traces yet. Traces group multiple LLM calls into one workflow, so an agent run reads
        as a single timeline instead of scattered requests:
      </span>

      <div className="w-full rounded-md border border-border bg-[#1a1816] px-3 py-2.5 text-left">
        <div className="flex items-center justify-between mb-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.05em] text-[#7c7770] flex items-center gap-1.5">
            <Terminal className="w-3 h-3" /> Instrument · @spanlens/sdk
          </span>
          <button
            type="button"
            onClick={() => void copy()}
            className="font-mono text-[11px] text-accent hover:opacity-80 transition-opacity flex items-center gap-1"
          >
            {copied ? (
              <>
                <Check className="w-3 h-3" /> Copied!
              </>
            ) : (
              <>
                <Copy className="w-3 h-3" /> Copy
              </>
            )}
          </button>
        </div>
        <pre className="font-mono text-[11px] text-good leading-relaxed whitespace-pre-wrap break-words">
          {TRACE_SNIPPET}
        </pre>
      </div>

      <span className="font-mono text-[10.5px] text-text-faint">
        Wrap your workflow with <code className="text-text-muted">startTrace</code> and{' '}
        <code className="text-text-muted">observe</code> from the SDK. New traces appear here
        automatically.
      </span>

      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
        <Link
          href="/docs/features/traces"
          className="font-mono text-[11.5px] text-accent hover:opacity-80 transition-opacity"
        >
          Tracing docs →
        </Link>
        <Link
          href="/docs/quick-start#tracing"
          className="font-mono text-[11.5px] text-text-muted hover:text-text transition-colors"
        >
          Quick start →
        </Link>
      </div>
    </div>
  )
}
