'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Zap } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const supabase = createClient()
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password })
    if (authError) {
      setError(authError.message)
      setLoading(false)
      return
    }
    router.push('/dashboard')
    router.refresh()
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
          <h1 className="text-[20px] font-semibold text-text mb-1 tracking-[-0.3px]">
            Welcome back
          </h1>
          <p className="text-[13px] text-text-muted mb-6">Sign in to your workspace</p>

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
                required
                className="w-full h-9 px-3 rounded-[6px] border border-border bg-bg text-[13px] text-text placeholder:text-text-faint focus:outline-none focus:border-border-strong transition-colors"
              />
            </div>
            {error && <p className="text-[12.5px] text-bad">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full h-9 rounded-[6px] bg-text text-bg text-[13px] font-medium hover:opacity-90 transition-opacity disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <p className="text-center text-[12.5px] text-text-muted mt-6">
            Don&apos;t have an account?{' '}
            <Link href="/signup" className="text-accent hover:opacity-80 transition-opacity">
              Sign up
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
