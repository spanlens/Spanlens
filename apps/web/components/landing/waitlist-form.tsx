'use client'
import { useState } from 'react'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'https://spanlens-server.vercel.app'

export function WaitlistForm() {
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return

    setState('loading')
    try {
      const res = await fetch(`${API_BASE}/api/v1/waitlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })
      const json = await res.json() as { success?: boolean; alreadyRegistered?: boolean; error?: string }

      if (res.ok && json.success) {
        if (json.alreadyRegistered) {
          setState('success')
          setMessage("You're already on the list — we'll be in touch soon.")
        } else {
          setState('success')
          setMessage("You're on the list! We'll reach out before the public launch.")
        }
      } else {
        setState('error')
        setMessage(json.error ?? 'Something went wrong. Please try again.')
      }
    } catch {
      setState('error')
      setMessage('Network error. Please try again.')
    }
  }

  if (state === 'success') {
    return (
      <div className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-accent-bg border border-accent-border text-accent font-mono text-[13px]">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M2 7l3.5 3.5L12 3.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        {message}
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row items-stretch gap-2 w-full sm:w-auto">
      <input
        type="email"
        required
        placeholder="you@company.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        disabled={state === 'loading'}
        className="px-3.5 py-2 rounded-lg border border-border bg-bg-elev font-mono text-[13px] text-text placeholder:text-text-faint focus:outline-none focus:ring-1 focus:ring-accent flex-1 min-w-0 sm:min-w-[220px] disabled:opacity-50"
      />
      <button
        type="submit"
        disabled={state === 'loading' || !email.trim()}
        className="px-4 py-2 rounded-lg bg-text text-bg font-mono text-[13px] hover:opacity-85 transition-opacity disabled:opacity-40 whitespace-nowrap"
      >
        {state === 'loading' ? 'Joining…' : 'Request access →'}
      </button>
      {state === 'error' && (
        <span className="text-[12px] text-red-500 font-mono self-center">{message}</span>
      )}
    </form>
  )
}
