'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Copy, Check, X, Terminal } from 'lucide-react'

/**
 * One-time welcome banner shown right after signup. Pulls the freshly
 * created Spanlens key from sessionStorage (stashed by the onboarding
 * flow) and walks the user through the three things they need to do to
 * make their first call:
 *
 *   1. Save SPANLENS_API_KEY into .env.local
 *   2. Add a provider key (OpenAI / Anthropic / Gemini) at /projects
 *   3. Paste the SDK helper snippet into their code
 *
 * Dismiss clears the storage key so the banner never reappears.
 */

const STORAGE_KEY = 'spanlens:welcome_api_key'

const SNIPPET_OPENAI = `import { createOpenAI } from '@spanlens/sdk/openai'

const openai = createOpenAI()
// Use it like a normal OpenAI SDK client:
// await openai.chat.completions.create({ ... })`

export function WelcomeBanner() {
  const [apiKey, setApiKey] = useState<string | null>(null)
  const [copiedKey, setCopiedKey] = useState(false)
  const [copiedSnippet, setCopiedSnippet] = useState(false)

  useEffect(() => {
    try {
      const key = sessionStorage.getItem(STORAGE_KEY)
      if (key) setApiKey(key)
    } catch {
      /* ignore */
    }
  }, [])

  if (!apiKey) return null

  async function copyKey() {
    try {
      await navigator.clipboard.writeText(apiKey!)
      setCopiedKey(true)
      setTimeout(() => setCopiedKey(false), 1500)
    } catch {
      /* ignore */
    }
  }

  async function copySnippet() {
    try {
      await navigator.clipboard.writeText(SNIPPET_OPENAI)
      setCopiedSnippet(true)
      setTimeout(() => setCopiedSnippet(false), 1500)
    } catch {
      /* ignore */
    }
  }

  function dismiss() {
    try {
      sessionStorage.removeItem(STORAGE_KEY)
    } catch {
      /* ignore */
    }
    setApiKey(null)
  }

  return (
    <div className="mx-[22px] mt-4 rounded-md border border-accent-border bg-accent-bg">
      <div className="px-5 py-4">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-[0.06em] text-accent font-semibold mb-1.5">
              Welcome to Spanlens
            </div>
            <div className="text-[14.5px] font-medium text-text">
              Your API key is ready. Three quick steps to your first logged request.
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

        {/* Step 1 — copy the key */}
        <div className="mb-4">
          <div className="text-[12px] font-medium text-text mb-2">
            <span className="font-mono text-[10px] text-accent mr-1.5">1.</span>
            Copy this key — it won&apos;t be shown again
          </div>
          <div className="flex items-center gap-2 bg-bg border border-border rounded-md px-3 py-2">
            <span className="font-mono text-[10px] text-text-faint uppercase tracking-[0.05em] shrink-0">
              SPANLENS_API_KEY
            </span>
            <code className="flex-1 font-mono text-[12px] text-text truncate">{apiKey}</code>
            <button
              type="button"
              onClick={() => void copyKey()}
              className="font-mono text-[11px] text-text-muted hover:text-text px-2 py-[3px] rounded border border-border-strong transition-colors flex items-center gap-1.5 shrink-0"
            >
              {copiedKey ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              {copiedKey ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="text-[11.5px] text-text-muted mt-1.5 leading-relaxed">
            Paste it into{' '}
            <code className="font-mono bg-bg border border-border px-1 rounded text-[10.5px]">
              .env.local
            </code>{' '}
            (or your deployment&apos;s env settings — Vercel, Railway, etc.).
          </p>
        </div>

        {/* Step 2 — register a provider key */}
        <div className="mb-4">
          <div className="text-[12px] font-medium text-text mb-2">
            <span className="font-mono text-[10px] text-accent mr-1.5">2.</span>
            Register an AI provider key (OpenAI / Anthropic / Gemini)
          </div>
          <p className="text-[11.5px] text-text-muted leading-relaxed">
            Open{' '}
            <Link
              href="/projects"
              className="text-accent hover:opacity-80 transition-opacity underline underline-offset-2"
            >
              /projects
            </Link>
            , find your Spanlens key, click <em>+ Add provider key</em>, and paste your AI
            provider&apos;s API key. Spanlens stores it encrypted and uses it on your
            behalf — your app never sees it again.
          </p>
        </div>

        {/* Step 3 — paste the snippet */}
        <div>
          <div className="text-[12px] font-medium text-text mb-2">
            <span className="font-mono text-[10px] text-accent mr-1.5">3.</span>
            Drop this into your code
          </div>
          <div className="rounded-md border border-border bg-[#1a1816] px-3 py-2.5">
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.05em] text-[#7c7770] flex items-center gap-1.5">
                <Terminal className="w-3 h-3" /> OpenAI · TypeScript
              </span>
              <button
                type="button"
                onClick={() => void copySnippet()}
                className="font-mono text-[11px] text-accent hover:opacity-80 transition-opacity flex items-center gap-1"
              >
                {copiedSnippet ? (
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
            <pre className="font-mono text-[11.5px] text-good leading-relaxed whitespace-pre-wrap break-words">
              {SNIPPET_OPENAI}
            </pre>
          </div>
          <p className="text-[11.5px] text-text-muted mt-1.5 leading-relaxed">
            Using Anthropic or Gemini instead? See the{' '}
            <Link
              href="/docs/quick-start#path-a"
              className="text-accent hover:opacity-80 transition-opacity underline underline-offset-2"
            >
              quick-start guide
            </Link>{' '}
            for the matching snippet.
          </p>
        </div>
      </div>
    </div>
  )
}
