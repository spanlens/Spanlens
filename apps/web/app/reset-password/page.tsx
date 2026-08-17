'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import {
  AuthField,
  AuthFootnote,
  AuthHeading,
  AuthLayout,
  AuthNote,
  authInput,
  authLink,
  authPrimaryButton,
} from '../auth/_components/auth-shell'

type SessionState = 'checking' | 'ready' | 'missing'

const STRENGTH_LABELS = ['too short', 'weak', 'fair', 'strong'] as const

/*
 * Four-segment meter from the A4 board. Purely advisory: the only rule the
 * submit path enforces is the 8-character minimum below, so this scores
 * length and character variety and never blocks a submission.
 */
function scorePassword(value: string): number {
  if (value.length < 8) return 0
  let score = 1
  if (value.length >= 12) score += 1
  if (/[^A-Za-z0-9]/.test(value) || (/[A-Z]/.test(value) && /[0-9]/.test(value))) score += 1
  return Math.min(score, 3)
}

function PasswordStrength({ value }: { value: string }) {
  const score = scorePassword(value)
  const filled = value.length === 0 ? 0 : score + 1
  const tone = score >= 3 ? 'bg-good' : score >= 1 ? 'bg-warn' : 'bg-bad'
  return (
    <div className="flex items-center gap-1.5" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className={`h-1 flex-1 rounded-full ${i < filled ? tone : 'bg-track'}`}
        />
      ))}
      <span
        className={`ml-1 w-[46px] shrink-0 font-mono text-[11.5px] leading-[1.48] ${
          value.length === 0 ? 'text-text-faint' : score >= 3 ? 'text-good' : score >= 1 ? 'text-warn' : 'text-bad'
        }`}
      >
        {value.length === 0 ? '' : STRENGTH_LABELS[score]}
      </span>
    </div>
  )
}

export default function ResetPasswordPage() {
  // The recovery session is established by /auth/callback before it forwards
  // here. We confirm it exists on mount so we can show a clear "link expired"
  // message instead of letting updateUser() fail with a cryptic error.
  const [sessionState, setSessionState] = useState<SessionState>('checking')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getSession().then(({ data }) => {
      setSessionState(data.session ? 'ready' : 'missing')
    })
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    setLoading(true)
    const supabase = createClient()
    const { error: authError } = await supabase.auth.updateUser({ password })
    if (authError) {
      setError(authError.message)
      setLoading(false)
      return
    }
    // Hard navigation so middleware re-evaluates the (now updated) session and
    // routes to /onboarding vs /dashboard correctly. See gotcha #15 — a
    // client-side router.push keeps a stale RSC tree.
    window.location.href = '/dashboard'
  }

  return (
    <AuthLayout
      pitch={{
        title: 'Pick something new.',
        body: 'Setting a new password signs out every other session on this account.',
      }}
    >
      {sessionState === 'checking' ? (
        <p className="text-[13.5px] leading-[1.6] text-text-faint" role="status">
          Verifying reset link…
        </p>
      ) : sessionState === 'missing' ? (
        <>
          <AuthHeading
            title="This link no longer works"
            subtitle="Reset links expire after 60 minutes and can only be opened once."
          />
          <AuthNote tone="bad">Request a fresh link and try again.</AuthNote>
          <AuthFootnote className="mt-[18px]">
            <Link href="/forgot-password" className={authLink}>
              Request a new link
            </Link>
          </AuthFootnote>
        </>
      ) : (
        <>
          <AuthHeading title="Set a new password" subtitle="This link works once and then expires." />

          <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2.5">
              <AuthField id="password" label="New password">
                <input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  minLength={8}
                  required
                  aria-invalid={error ? true : undefined}
                  className={authInput}
                />
              </AuthField>
              <PasswordStrength value={password} />
            </div>

            <AuthField id="confirm" label="Confirm password">
              <input
                id="confirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Re-enter password"
                minLength={8}
                required
                aria-invalid={error ? true : undefined}
                className={authInput}
              />
            </AuthField>

            {error && <AuthNote tone="bad" live="assertive">{error}</AuthNote>}

            <button type="submit" disabled={loading} className={`${authPrimaryButton} mt-1.5`}>
              {loading ? 'Updating…' : 'Save and sign in'}
            </button>
          </form>
        </>
      )}
    </AuthLayout>
  )
}
