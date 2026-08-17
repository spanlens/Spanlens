'use client'

import { useState } from 'react'

/**
 * CopyPermalink — small button in the share viewer header that copies
 * the current URL to the clipboard. Shows a transient "Copied" state
 * so the user knows the click landed without us shipping a toast lib.
 *
 * Why we don't read `window.location.href` lazily: the share page is
 * fully SSR (no auth on the public token), so `window` would crash
 * the first render. The page passes the canonical URL down explicitly
 * (computed from the token + WEB_URL env) so SSR and CSR agree.
 *
 * Fallback path: if `navigator.clipboard.writeText` rejects (older
 * Safari over http, blocked permissions), we surface a tiny "Press
 * Ctrl+C" hint that lets the user select the URL from a visible input.
 * Pure progressive enhancement — the button never throws.
 */
export function CopyPermalink({ url }: { url: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'fallback'>('idle')

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url)
      setState('copied')
      setTimeout(() => setState('idle'), 1800)
    } catch {
      setState('fallback')
      setTimeout(() => setState('idle'), 4000)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={handleCopy}
        className="inline-flex h-9 items-center rounded-full border border-border bg-bg-elev px-4 font-mono text-[11.5px] text-text transition-colors hover:border-border-strong hover:bg-bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg-elev"
        aria-label="Copy permalink to this shared view"
      >
        {state === 'copied' ? 'Copied' : 'Copy link'}
      </button>
      {state === 'fallback' ? (
        <input
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className="max-w-[200px] rounded border border-border bg-bg-sunk px-2 py-1 font-mono text-[10.5px] text-text"
        />
      ) : null}
    </div>
  )
}
