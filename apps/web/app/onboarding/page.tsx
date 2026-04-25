'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { apiPost } from '@/lib/api'
import { cn } from '@/lib/utils'

/**
 * Two-step post-signup onboarding:
 *
 *   1) Workspace — user names their workspace; we call POST /organizations/bootstrap
 *      with that name. This creates the org + admin membership + default
 *      project + first API key (server-side, atomic). The raw API key is
 *      stashed in sessionStorage so the WelcomeBanner on /dashboard can
 *      reveal it once.
 *
 *   2) Survey — two radio questions ("What are you building?" + "Your role?").
 *      Both optional. Whether the user fills them in or hits Skip, we POST
 *      /me/profile/complete which sets `onboarded_at` so the dashboard
 *      layout stops redirecting them back here.
 *
 * Provider keys + API keys deliberately do NOT live in onboarding anymore:
 * most new users don't have an OpenAI key handy at signup, and the API
 * key is auto-generated. Both surface naturally on /projects + the
 * WelcomeBanner once the user is in the dashboard.
 */

type Step = 'workspace' | 'survey'
const STEP_ORDER: Step[] = ['workspace', 'survey']

interface BootstrapResponse {
  data?: {
    apiKey?: string
  }
}

const USE_CASES = [
  { id: 'chatbot',         label: 'Chatbot',          hint: 'Customer support, internal Q&A, AI assistants' },
  { id: 'rag',             label: 'RAG / Search',     hint: 'Knowledge base, semantic search, retrieval' },
  { id: 'agent',           label: 'AI Agent',         hint: 'Multi-step workflows, tool use, autonomous' },
  { id: 'code_assistant',  label: 'Code assistant',   hint: 'Code generation, review, completion' },
  { id: 'internal_tool',   label: 'Internal tool',    hint: 'Summarisation, classification, automation' },
  { id: 'other',           label: 'Something else',   hint: '' },
] as const

const ROLES = [
  { id: 'engineer',  label: 'Engineer' },
  { id: 'product',   label: 'Product / Design' },
  { id: 'founder',   label: 'Founder / Exec' },
  { id: 'researcher', label: 'Researcher' },
  { id: 'other',     label: 'Other' },
] as const

type UseCase = (typeof USE_CASES)[number]['id']
type Role = (typeof ROLES)[number]['id']

export default function OnboardingPage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>('workspace')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Step 1
  const [workspaceName, setWorkspaceName] = useState('')

  // Step 2
  const [useCase, setUseCase] = useState<UseCase | null>(null)
  const [role, setRole] = useState<Role | null>(null)

  const currentStepIdx = STEP_ORDER.indexOf(step)

  async function handleWorkspaceSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = workspaceName.trim()
    if (!trimmed) {
      setError('Workspace name is required.')
      return
    }
    if (trimmed.length > 80) {
      setError('Workspace name must be 80 characters or fewer.')
      return
    }
    setError('')
    setLoading(true)
    try {
      // Server returns 409 if the user already has a workspace (e.g. from a
      // partial earlier signup). Treat that as success and move on — the
      // dashboard handles the existing-org case fine.
      const res = await apiPost<BootstrapResponse>(
        '/api/v1/organizations/bootstrap',
        { name: trimmed },
      ).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : ''
        if (/already onboarded/i.test(msg)) return null
        throw err
      })

      if (res?.data?.apiKey) {
        try {
          sessionStorage.setItem('spanlens:welcome_api_key', res.data.apiKey)
        } catch {
          // sessionStorage blocked — the welcome banner just won't show.
        }
      }
      setStep('survey')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create workspace.')
    } finally {
      setLoading(false)
    }
  }

  async function completeSurvey(includeAnswers: boolean): Promise<void> {
    setError('')
    setLoading(true)
    try {
      // Always POST — the endpoint stamps onboarded_at regardless of whether
      // the survey is filled in. Skipping just sends nulls.
      await apiPost('/api/v1/me/profile/complete', includeAnswers
        ? { use_case: useCase, role }
        : {},
      )
      router.push('/dashboard')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save profile.')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-bg-elev flex flex-col items-center px-6 py-10">
      {/* Header */}
      <Link href="/" className="flex items-center gap-2 mb-7 hover:opacity-80 transition-opacity">
        <svg width="20" height="20" viewBox="0 0 20 20" className="shrink-0">
          <circle cx="10" cy="10" r="8" fill="none" stroke="var(--text)" strokeWidth="1.5" />
          <circle cx="10" cy="10" r="3.5" fill="var(--accent)" />
        </svg>
        <span className="font-semibold text-[16px] tracking-[-0.3px] text-text">spanlens</span>
      </Link>

      {/* Stepper */}
      <Stepper currentIdx={currentStepIdx} />

      {/* Card */}
      <div className="w-[480px] max-w-full bg-bg border border-border rounded-[10px] p-7 shadow-sm">
        {step === 'workspace' && (
          <form onSubmit={(e) => void handleWorkspaceSubmit(e)}>
            <h1 className="text-[22px] font-medium tracking-[-0.4px] mb-1.5">Name your workspace</h1>
            <p className="text-[13px] text-text-muted mb-5 leading-relaxed">
              Usually your company or team name. You can change it later in Settings.
            </p>

            <label className="block text-[12px] text-text-muted mb-1.5">Workspace name</label>
            <input
              type="text"
              autoFocus
              value={workspaceName}
              onChange={(e) => setWorkspaceName(e.target.value)}
              placeholder="Acme Inc."
              maxLength={80}
              className="w-full px-3 py-2 border border-border-strong rounded-[6px] bg-bg-elev text-[13px] outline-none focus:border-accent"
            />

            {error && <p className="text-[12.5px] text-bad mt-3">{error}</p>}

            <button
              type="submit"
              disabled={loading || !workspaceName.trim()}
              className="w-full mt-5 bg-text text-bg py-[11px] px-[14px] rounded-[7px] text-[13px] font-medium hover:opacity-90 transition-opacity disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
            >
              {loading ? 'Creating workspace…' : 'Continue →'}
            </button>
          </form>
        )}

        {step === 'survey' && (
          <div>
            <h1 className="text-[22px] font-medium tracking-[-0.4px] mb-1.5">Tell us about your project</h1>
            <p className="text-[13px] text-text-muted mb-5 leading-relaxed">
              Helps us prioritize what to build. Both questions are optional — feel free to skip.
            </p>

            <div className="space-y-5">
              <div>
                <div className="text-[12.5px] text-text font-medium mb-2">What are you building?</div>
                <div className="grid grid-cols-2 gap-1.5">
                  {USE_CASES.map((opt) => (
                    <RadioCard
                      key={opt.id}
                      checked={useCase === opt.id}
                      onClick={() => setUseCase(useCase === opt.id ? null : opt.id)}
                      label={opt.label}
                      hint={opt.hint}
                    />
                  ))}
                </div>
              </div>

              <div>
                <div className="text-[12.5px] text-text font-medium mb-2">What&apos;s your role?</div>
                <div className="flex flex-wrap gap-1.5">
                  {ROLES.map((opt) => (
                    <Chip
                      key={opt.id}
                      checked={role === opt.id}
                      onClick={() => setRole(role === opt.id ? null : opt.id)}
                      label={opt.label}
                    />
                  ))}
                </div>
              </div>
            </div>

            {error && <p className="text-[12.5px] text-bad mt-4">{error}</p>}

            <div className="flex gap-2 mt-6 justify-end">
              <button
                type="button"
                onClick={() => void completeSurvey(false)}
                disabled={loading}
                className="font-mono text-[12px] px-4 py-[9px] border border-border rounded-[6px] text-text-muted hover:text-text transition-colors disabled:opacity-40"
              >
                Skip
              </button>
              <button
                type="button"
                onClick={() => void completeSurvey(true)}
                disabled={loading || (!useCase && !role)}
                className="bg-text text-bg py-[9px] px-4 rounded-[6px] text-[12.5px] font-medium hover:opacity-90 transition-opacity disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
              >
                {loading ? 'Saving…' : 'Continue to dashboard →'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Stepper({ currentIdx }: { currentIdx: number }) {
  const labels = ['Workspace', 'About you']
  return (
    <div className="flex items-center gap-3 mb-7">
      {labels.map((label, i) => {
        const isCurrent = i === currentIdx
        const isDone = i < currentIdx
        return (
          <div key={label} className="flex items-center gap-3">
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={cn(
                  'w-7 h-7 rounded-full flex items-center justify-center font-mono text-[11px] font-medium',
                  isDone && 'bg-accent text-bg',
                  isCurrent && 'bg-accent text-bg',
                  !isDone && !isCurrent && 'bg-bg-muted text-text-faint border border-border',
                )}
              >
                {isDone ? '✓' : i + 1}
              </div>
              <div className={cn('font-mono text-[10.5px] tracking-[0.04em] uppercase', isCurrent ? 'text-text' : 'text-text-faint')}>
                {label}
              </div>
            </div>
            {i < labels.length - 1 && <div className="w-12 h-px bg-border -mt-4" />}
          </div>
        )
      })}
    </div>
  )
}

function RadioCard({
  checked, onClick, label, hint,
}: {
  checked: boolean
  onClick: () => void
  label: string
  hint?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'text-left p-2.5 rounded-[6px] border transition-colors',
        checked
          ? 'border-accent bg-accent-bg'
          : 'border-border hover:border-border-strong bg-bg-elev',
      )}
    >
      <div className={cn('text-[12.5px] font-medium', checked ? 'text-accent' : 'text-text')}>{label}</div>
      {hint && (
        <div className={cn('text-[11px] mt-0.5 leading-snug', checked ? 'text-accent' : 'text-text-faint')}>
          {hint}
        </div>
      )}
    </button>
  )
}

function Chip({
  checked, onClick, label,
}: {
  checked: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'text-[12px] px-3 py-1.5 rounded-full border transition-colors',
        checked
          ? 'border-accent bg-accent-bg text-accent font-medium'
          : 'border-border text-text-muted hover:border-border-strong hover:text-text',
      )}
    >
      {label}
    </button>
  )
}
