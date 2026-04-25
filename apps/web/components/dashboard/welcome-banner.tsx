'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Copy, Check, X } from 'lucide-react'

/**
 * One-time welcome banner shown right after signup. The API key is pulled
 * from sessionStorage (stashed there by the signup page) and displayed so the
 * user can copy it into their code. Dismiss clears the storage key, so the
 * banner never reappears on next login.
 *
 * If there's no stashed key (existing user / normal dashboard visit), the
 * component renders nothing.
 */

const STORAGE_KEY = 'spanlens:welcome_api_key'

export function WelcomeBanner() {
  const [apiKey, setApiKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Read once on mount. sessionStorage access is safe in 'use client'.
  useEffect(() => {
    try {
      const key = sessionStorage.getItem(STORAGE_KEY)
      if (key) setApiKey(key)
    } catch { /* ignore */ }
  }, [])

  if (!apiKey) return null

  async function copyKey() {
    try {
      await navigator.clipboard.writeText(apiKey!)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* ignore — user can select manually */ }
  }

  function dismiss() {
    try {
      sessionStorage.removeItem(STORAGE_KEY)
    } catch { /* ignore */ }
    setApiKey(null)
  }

  return (
    <div className="mx-[22px] mt-4 rounded-md border border-accent-border bg-accent-bg">
      <div className="flex items-start justify-between gap-4 px-5 py-4">
        <div className="flex-1 min-w-0">
          <div className="font-mono text-[10px] uppercase tracking-[0.06em] text-accent font-semibold mb-1.5">
            Welcome to Spanlens
          </div>
          <div className="text-[14.5px] font-medium text-text mb-1">
            Your API key is ready. Copy it now — it won&apos;t be shown again.
          </div>
          <p className="text-[12.5px] text-text-muted leading-relaxed mb-3">
            Paste it into your code, send a request, and watch it appear here live.
            Add a provider key in{' '}
            <Link href="/settings" className="text-accent hover:opacity-80 transition-opacity">
              Settings
            </Link>{' '}
            when you&apos;re ready to proxy to OpenAI/Anthropic/Gemini.
          </p>
          <div className="flex items-center gap-2 bg-bg border border-border rounded-md px-3 py-2">
            <span className="font-mono text-[10px] text-text-faint uppercase tracking-[0.05em] shrink-0">
              SPANLENS_API_KEY
            </span>
            <code className="flex-1 font-mono text-[12px] text-text truncate">{apiKey}</code>
            <button
              type="button"
              onClick={() => void copyKey()}
              className="font-mono text-[11px] text-text-muted hover:text-text px-2 py-[3px] rounded border border-border-strong transition-colors flex items-center gap-1.5"
            >
              {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="text-text-faint hover:text-text-muted transition-colors shrink-0 mt-0.5"
          aria-label="Dismiss welcome banner"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
