'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Copy, Check, X, Terminal, CheckCircle2, Loader2, RefreshCw, ShieldCheck } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { consumeWelcomeStash, clearWelcomeStash } from '@/lib/welcome-stash'
import { useProviderKeys } from '@/lib/queries/use-provider-keys'
import { useRequests } from '@/lib/queries/use-requests'

/**
 * One-time welcome banner shown right after signup. Pulls the freshly
 * created Spanlens key from sessionStorage (stashed by the onboarding
 * flow) and walks the user through the four things they need to do to
 * confirm their first logged call:
 *
 *   1. Save SPANLENS_API_KEY into .env.local
 *   2. Add a provider key (OpenAI / Anthropic / Gemini) at /projects
 *   3. Paste the SDK helper snippet into their code
 *   4. Verify it worked — fire a test call and watch the first request land
 *
 * Lifecycle contract — see lib/welcome-stash.ts for the full rationale:
 *
 *   - The stash is **consumed on first mount**: read, validated against the
 *     current signed-in user, and removed. Refreshing /dashboard or
 *     navigating away then back will not re-display the key.
 *   - If the stashed `userId` does not match the signed-in user, the entry
 *     is silently discarded (cross-account leak protection on shared tabs).
 *   - Dismiss is now purely a UI affordance — the storage entry is
 *     already gone by the time the X button is clickable.
 *
 * The data-fetching (provider-key + first-request polling) lives in the
 * inner component so those queries only mount while the banner is actually
 * shown — existing users who never see the banner pay nothing.
 */

const SNIPPET_OPENAI = `import { createOpenAI } from '@spanlens/sdk/openai'

const openai = createOpenAI()
// Use it like a normal OpenAI SDK client:
// await openai.chat.completions.create({ ... })`

/** Copy-paste test call through the Spanlens proxy, pre-filled with the key. */
function buildTestCurl(apiKey: string): string {
  return `curl https://api.spanlens.io/proxy/openai/v1/chat/completions \\
  -H "Authorization: Bearer ${apiKey}" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"Hello from Spanlens"}]}'`
}

export function WelcomeBanner() {
  // Start null so the first client render matches the server (sessionStorage
  // is browser-only; the server always renders nothing here). Reading it
  // during render / via lazy useState init would diverge from SSR and trigger
  // a hydration mismatch — see gotcha #22. We resolve it after mount.
  const [apiKey, setApiKey] = useState<string | null>(null)

  useEffect(() => {
    // Resolve the current user, then consume the stash IF it was written
    // for this user. Anything else (no session, no stash, mismatched user,
    // bad JSON) ends with the stash cleared and no banner shown.
    let cancelled = false
    void (async () => {
      try {
        const supabase = createClient()
        const { data, error } = await supabase.auth.getUser()
        if (cancelled) return
        if (error || !data.user) {
          clearWelcomeStash()
          return
        }
        const key = consumeWelcomeStash(data.user.id)
        if (key) setApiKey(key)
      } catch {
        clearWelcomeStash()
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (!apiKey) return null

  return (
    <WelcomeBannerInner
      apiKey={apiKey}
      onDismiss={() => {
        // Storage was already consumed on mount; this only drops the
        // in-memory copy so the banner unmounts. Defensive clear in case a
        // future change re-introduces a stashed entry mid-session.
        clearWelcomeStash()
        setApiKey(null)
      }}
    />
  )
}

type KeyCheckState = 'idle' | 'checking' | 'ok' | 'failed'

function WelcomeBannerInner({ apiKey, onDismiss }: { apiKey: string; onDismiss: () => void }) {
  const [copiedKey, setCopiedKey] = useState(false)
  const [copiedSnippet, setCopiedSnippet] = useState(false)
  const [copiedCurl, setCopiedCurl] = useState(false)

  // Step 1 verification — introspects the freshly issued key against the
  // server's key-info endpoint. Same-origin path: the Next.js rewrite in
  // next.config.mjs forwards /api/* to spanlens-server, exactly like the
  // banner's other queries (useProviderKeys / useRequests via lib/api.ts),
  // so no CORS preflight and no hardcoded server host. Auth here is the
  // sl_live_* key itself (authApiKey on the server), not the user JWT.
  const [keyCheck, setKeyCheck] = useState<KeyCheckState>('idle')

  async function verifyKey() {
    if (keyCheck === 'checking') return
    setKeyCheck('checking')
    try {
      const res = await fetch('/api/v1/me/key-info', {
        headers: { Authorization: `Bearer ${apiKey}` },
        cache: 'no-store',
      })
      setKeyCheck(res.ok ? 'ok' : 'failed')
    } catch {
      setKeyCheck('failed')
    }
  }

  // Step 2 status — flips to a checkmark once any provider key exists.
  const providerKeys = useProviderKeys()
  const hasProviderKey = (providerKeys.data?.length ?? 0) > 0

  // Step 4 status — poll the request log (limit 1, we only need the count).
  // useRequests already refetches every ~30s and on window focus, so the
  // banner updates itself as soon as the first call lands.
  const firstRequest = useRequests({ page: 1, limit: 1 })
  const requestReceived = (firstRequest.data?.meta.total ?? 0) > 0

  async function copy(text: string, mark: (v: boolean) => void) {
    try {
      await navigator.clipboard.writeText(text)
      mark(true)
      setTimeout(() => mark(false), 1500)
    } catch {
      /* ignore */
    }
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
              Your API key is ready. Four quick steps to your first logged request.
            </div>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            className="text-text-faint hover:text-text-muted transition-colors shrink-0 mt-0.5"
            aria-label="Dismiss welcome banner"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Step 1, copy the key */}
        <div className="mb-4">
          <div className="text-[12px] font-medium text-text mb-2">
            <span className="font-mono text-[10px] text-accent mr-1.5">1.</span>
            Copy this key, it won&apos;t be shown again
          </div>
          <div className="flex items-center gap-2 bg-bg border border-border rounded-md px-3 py-2">
            <span className="font-mono text-[10px] text-text-faint uppercase tracking-[0.05em] shrink-0">
              SPANLENS_API_KEY
            </span>
            <code className="flex-1 font-mono text-[12px] text-text truncate">{apiKey}</code>
            <button
              type="button"
              onClick={() => void copy(apiKey, setCopiedKey)}
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
            (or your deployment&apos;s env settings, Vercel, Railway, etc.).
          </p>
          <div className="flex items-center gap-2 mt-2">
            <button
              type="button"
              onClick={() => void verifyKey()}
              disabled={keyCheck === 'checking'}
              className="font-mono text-[10.5px] px-[8px] py-[3px] border border-border rounded-[5px] text-text-muted hover:text-text hover:border-border-strong disabled:opacity-40 transition-colors inline-flex items-center gap-1"
            >
              {keyCheck === 'checking' ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <ShieldCheck className="w-3 h-3" />
              )}
              Verify key
            </button>
            {keyCheck === 'ok' && (
              <span className="inline-flex items-center gap-1 text-good font-mono text-[10.5px]">
                <CheckCircle2 className="w-3.5 h-3.5" /> Key is active
              </span>
            )}
            {keyCheck === 'failed' && (
              <span className="font-mono text-[10.5px] text-bad">
                Key check failed. Check the env var name and restart your dev server.
              </span>
            )}
          </div>
        </div>

        {/* Step 2, register a provider key — checkmark once one exists */}
        <div className="mb-4">
          <div className="text-[12px] font-medium text-text mb-2 flex items-center gap-1.5">
            <span className="font-mono text-[10px] text-accent">2.</span>
            Register an AI provider key (OpenAI / Anthropic / Gemini)
            {hasProviderKey && (
              <span className="inline-flex items-center gap-1 text-good font-mono text-[10.5px]">
                <CheckCircle2 className="w-3.5 h-3.5" /> Done
              </span>
            )}
          </div>
          {hasProviderKey ? (
            <p className="text-[11.5px] text-text-muted leading-relaxed">
              Provider key registered. Spanlens stores it encrypted and uses it on your behalf.
            </p>
          ) : (
            <>
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
                behalf, your app never sees it again.
              </p>
              {/* Immediate refetch so the checkmark flips right after the user
                  adds a key at /projects, rather than waiting on the ~30s
                  provider-keys poll. Mirrors step 4's "Check now" button. */}
              <div className="flex items-center gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => void providerKeys.refetch()}
                  disabled={providerKeys.isFetching}
                  className="font-mono text-[10.5px] px-[8px] py-[3px] border border-border rounded-[5px] text-text-muted hover:text-text hover:border-border-strong disabled:opacity-40 transition-colors inline-flex items-center gap-1"
                >
                  <RefreshCw className={providerKeys.isFetching ? 'w-3 h-3 animate-spin' : 'w-3 h-3'} />
                  Check now
                </button>
              </div>
            </>
          )}
        </div>

        {/* Step 3, paste the snippet */}
        <div className="mb-4">
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
                onClick={() => void copy(SNIPPET_OPENAI, setCopiedSnippet)}
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

        {/* Step 4, verify it worked — live first-request detection */}
        <div>
          <div className="text-[12px] font-medium text-text mb-2 flex items-center gap-1.5">
            <span className="font-mono text-[10px] text-accent">4.</span>
            Verify it worked
            {requestReceived && (
              <span className="inline-flex items-center gap-1 text-good font-mono text-[10.5px]">
                <CheckCircle2 className="w-3.5 h-3.5" /> Received
              </span>
            )}
          </div>

          {requestReceived ? (
            <p className="text-[11.5px] text-text-muted leading-relaxed">
              First request received, you&apos;re all set.{' '}
              <Link
                href="/requests"
                className="text-accent hover:opacity-80 transition-opacity underline underline-offset-2"
              >
                View it in the request log →
              </Link>
            </p>
          ) : (
            <>
              <p className="text-[11.5px] text-text-muted mb-2 leading-relaxed">
                No code yet? Fire a one-off test call from your terminal (needs a provider key
                from step 2):
              </p>
              <div className="rounded-md border border-border bg-[#1a1816] px-3 py-2.5">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-mono text-[10px] uppercase tracking-[0.05em] text-[#7c7770] flex items-center gap-1.5">
                    <Terminal className="w-3 h-3" /> Test call · curl
                  </span>
                  <button
                    type="button"
                    onClick={() => void copy(buildTestCurl(apiKey), setCopiedCurl)}
                    className="font-mono text-[11px] text-accent hover:opacity-80 transition-opacity flex items-center gap-1"
                  >
                    {copiedCurl ? (
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
                  {buildTestCurl(apiKey)}
                </pre>
              </div>
              <p className="text-[11px] text-text-faint mt-2 leading-relaxed">
                Requests usually show up within a few seconds of the call completing, and this
                dashboard refreshes on its own.
              </p>
              <div className="flex items-center gap-2 mt-1.5">
                <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-text-faint">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Waiting for your first request…
                </span>
                <button
                  type="button"
                  onClick={() => void firstRequest.refetch()}
                  disabled={firstRequest.isFetching}
                  className="font-mono text-[10.5px] px-[8px] py-[3px] border border-border rounded-[5px] text-text-muted hover:text-text hover:border-border-strong disabled:opacity-40 transition-colors inline-flex items-center gap-1"
                >
                  <RefreshCw className={firstRequest.isFetching ? 'w-3 h-3 animate-spin' : 'w-3 h-3'} />
                  Check now
                </button>
              </div>
            </>
          )}
        </div>

        {/* Free-tier footnote — sets expectations on the monthly allowance so
            new users aren't surprised by the quota. Kept muted, not a callout. */}
        <p className="text-[11px] text-text-faint mt-4 leading-relaxed">
          Free tier includes 50,000 requests per month. You can upgrade anytime from{' '}
          <Link
            href="/billing"
            className="text-accent hover:opacity-80 transition-opacity underline underline-offset-2"
          >
            Billing
          </Link>
          .
        </p>
      </div>
    </div>
  )
}
