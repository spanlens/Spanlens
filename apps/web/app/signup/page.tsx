'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Zap } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

export default function SignupPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [consent, setConsent] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!consent) {
      setError('You must agree to the Terms of Service and Privacy Policy to continue.')
      return
    }
    setLoading(true)
    const supabase = createClient()
    const { error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    })
    if (authError) {
      setError(authError.message)
      setLoading(false)
      return
    }
    setSent(true)
    setLoading(false)
    setTimeout(() => router.push('/onboarding'), 1000)
  }

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center px-4">
      <div className="w-full max-w-[360px]">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 mb-8 justify-center">
          <Zap className="h-5 w-5 text-accent" strokeWidth={2.5} />
          <span className="font-semibold text-[17px] text-text tracking-[-0.3px]">Spanlens</span>
        </Link>

        {/* Card */}
        <div className="rounded-xl border border-border bg-bg-elev px-8 py-8">
          {sent ? (
            <div className="text-center py-4">
              <div className="w-12 h-12 rounded-full bg-good-bg border border-good/20 flex items-center justify-center mx-auto mb-4">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path
                    d="M4 10l4 4 8-8"
                    stroke="var(--good)"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <h2 className="text-[16px] font-semibold text-text mb-2">Check your email</h2>
              <p className="text-[12.5px] text-text-muted">
                Confirmation sent to{' '}
                <strong className="text-text font-medium">{email}</strong>
              </p>
            </div>
          ) : (
            <>
              <h1 className="text-[20px] font-semibold text-text mb-1 tracking-[-0.3px]">
                Create your account
              </h1>
              <p className="text-[13px] text-text-muted mb-6">
                Free to start — no credit card required
              </p>

              <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[12.5px] text-text-muted font-medium" htmlFor="email">
                    Email
                  </label>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                    className="w-full h-9 px-3 rounded-[6px] border border-border bg-bg text-[13px] text-text placeholder:text-text-faint focus:outline-none focus:border-border-strong transition-colors"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[12.5px] text-text-muted font-medium" htmlFor="password">
                    Password
                  </label>
                  <input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    minLength={8}
                    required
                    className="w-full h-9 px-3 rounded-[6px] border border-border bg-bg text-[13px] text-text placeholder:text-text-faint focus:outline-none focus:border-border-strong transition-colors"
                  />
                </div>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                    className="mt-0.5 h-3.5 w-3.5 rounded border-border accent-accent shrink-0"
                  />
                  <span className="text-[12px] text-text-muted">
                    I agree to the{' '}
                    <Link
                      href="/terms"
                      target="_blank"
                      className="text-accent hover:opacity-80 transition-opacity"
                    >
                      Terms of Service
                    </Link>{' '}
                    and{' '}
                    <Link
                      href="/privacy"
                      target="_blank"
                      className="text-accent hover:opacity-80 transition-opacity"
                    >
                      Privacy Policy
                    </Link>
                  </span>
                </label>
                {error && <p className="text-[12.5px] text-bad">{error}</p>}
                <button
                  type="submit"
                  disabled={loading || !consent}
                  className="w-full h-9 rounded-[6px] bg-text text-bg text-[13px] font-medium hover:opacity-90 transition-opacity disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                >
                  {loading ? 'Creating account…' : 'Create account'}
                </button>
              </form>
            </>
          )}
          <p className="text-center text-[12.5px] text-text-muted mt-6">
            Already have an account?{' '}
            <Link href="/login" className="text-accent hover:opacity-80 transition-opacity">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
