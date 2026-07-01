'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Copy, Check, Terminal } from 'lucide-react'

/**
 * First-run hint shown in the requests table when the account has no logged
 * requests yet (and no filters are hiding them). Gives a copy-paste test
 * call so a new user can confirm the proxy works without wiring code first;
 * the request list polls on its own, so the row appears here automatically
 * once the call lands.
 */
const TEST_CURL = `curl https://server.spanlens.io/proxy/openai/v1/chat/completions \\
  -H "Authorization: Bearer $SPANLENS_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"Hello from Spanlens"}]}'`

export function EmptyRequestsHint() {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(TEST_CURL)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="flex flex-col items-center gap-3 max-w-xl w-full">
      <span className="text-[13px] text-text-muted">
        No requests yet. Make your first API call through the proxy, or fire a quick test:
      </span>

      <div className="w-full rounded-md border border-border bg-[#1a1816] px-3 py-2.5 text-left">
        <div className="flex items-center justify-between mb-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.05em] text-[#7c7770] flex items-center gap-1.5">
            <Terminal className="w-3 h-3" /> Test call · curl
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
          {TEST_CURL}
        </pre>
      </div>

      <span className="font-mono text-[10.5px] text-text-faint">
        Set <code className="text-text-muted">SPANLENS_API_KEY</code> first. New requests appear here
        automatically.
      </span>

      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
        <Link
          href="/projects"
          className="font-mono text-[11.5px] text-accent hover:opacity-80 transition-opacity"
        >
          Add provider key →
        </Link>
        <Link
          href="/docs/quick-start"
          className="font-mono text-[11.5px] text-text-muted hover:text-text transition-colors"
        >
          Quick start →
        </Link>
      </div>
    </div>
  )
}
