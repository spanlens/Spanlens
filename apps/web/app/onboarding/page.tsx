'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'

import { apiPost } from '@/lib/api'
import {
  useAcceptPendingInvitation,
  usePendingInvitations,
  type PendingInvitation,
} from '@/lib/queries/use-pending-invitations'
import { writeWorkspaceCookie } from '@/lib/workspace-cookie'
import { cn } from '@/lib/utils'

/**
 * Three-phase post-signup onboarding:
 *
 *   0) Pending invitations (auto-detected) — appears ONLY when the
 *      signed-in user's email has at least one open invitation. They
 *      can Accept (joins that workspace + skips the rest of onboarding)
 *      or Skip & create their own workspace (drops into step 1).
 *
 *   1) Workspace — user names their own workspace; bootstrap creates
 *      org + admin membership + default project + first API key.
 *
 *   2) Survey — "What are you building?" + "Your role?". Both optional.
 *      The completion endpoint stamps onboarded_at either way.
 *
 * Provider keys + API keys deliberately do NOT live in onboarding.
 */

type Step = 'pending' | 'workspace' | 'survey'

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
  // We don't know yet whether to start at 'pending' or 'workspace' —
  // depends on the API response. Start in a transient loading state.
  const [step, setStep] = useState<Step | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const pending = usePendingInvitations()
  const acceptInvite = useAcceptPendingInvitation()

  // Decide initial step once the pending fetch resolves. After this point,
  // the user drives the step transitions manually.
  useEffect(() => {
    if (step !== null) return
    if (!pending.isFetched) return
    setStep((pending.data?.length ?? 0) > 0 ? 'pending' : 'workspace')
  }, [pending.isFetched, pending.data, step])

  // Step 1
  const [workspaceName, setWorkspaceName] = useState('')

  // Step 2
  const [useCase, setUseCase] = useState<UseCase | null>(null)
  const [role, setRole] = useState<Role | null>(null)

  // Stepper visible only on the workspace + survey legs (the pending
  // step is its own world — different content, different action set).
  const showStepper = step === 'workspace' || step === 'survey'
  const stepperIdx = step === 'survey' ? 1 : 0

  async function handleAcceptInvite(inv: PendingInvitation): Promise<void> {
    setError('')
    setLoading(true)
    try {
      await acceptInvite.mutateAsync(inv.id)
      // Make the joined workspace the active one + force a hard reload so
      // middleware re-resolves cookies and the dashboard renders with the
      // new org as the active workspace.
      writeWorkspaceCookie(inv.orgId)
      window.location.href = '/dashboard'
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to accept invitation.')
      setLoading(false)
    }
  }

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
      // partial earlier signup). Treat that as success and move on.
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
      await apiPost('/api/v1/me/profile/complete', includeAnswers
        ? { use_case: useCase, role }
        : {},
      )
      // Hard navigation — `router.push` keeps the RSC tree cached, the
      // dashboard layout would re-evaluate with stale headers, and
      // `x-spanlens-onboarded` would still be missing → bounce back here.
      window.location.href = '/dashboard'
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
      {showStepper && <Stepper currentIdx={stepperIdx} />}

      {/* Card */}
      <div className="w-[480px] max-w-full bg-bg border border-border rounded-[10px] p-7 shadow-sm">
        {step === null && (
          <div className="text-[13px] text-text-muted">Loading…</div>
        )}

        {step === 'pending' && pending.data && pending.data.length > 0 && (
          <PendingInvitationsStep
            invitations={pending.data}
            onAccept={(inv) => void handleAcceptInvite(inv)}
            onSkip={() => setStep('workspace')}
            loading={loading}
            error={error}
          />
        )}

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

function PendingInvitationsStep({
  invitations,
  onAccept,
  onSkip,
  loading,
  error,
}: {
  invitations: PendingInvitation[]
  onAccept: (inv: PendingInvitation) => void
  onSkip: () => void
  loading: boolean
  error: string
}) {
  return (
    <div>
      <h1 className="text-[22px] font-medium tracking-[-0.4px] mb-1.5">You&apos;ve been invited</h1>
      <p className="text-[13px] text-text-muted mb-5 leading-relaxed">
        Someone added you to {invitations.length === 1 ? 'a' : 'these'} Spanlens
        {invitations.length === 1 ? ' workspace' : ' workspaces'}. Join now, or
        skip and create your own.
      </p>

      <div className="space-y-2 mb-5">
        {invitations.map((inv) => (
          <div
            key={inv.id}
            className="flex items-center justify-between gap-3 p-3 rounded-[6px] border border-border bg-bg-elev"
          >
            <div className="min-w-0">
              <div className="text-[14px] font-medium text-text truncate">{inv.orgName}</div>
              <div className="font-mono text-[11px] text-text-muted mt-0.5">
                Role: <span className="text-accent">{inv.role}</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onAccept(inv)}
              disabled={loading}
              className="bg-text text-bg py-[8px] px-[14px] rounded-[6px] text-[12.5px] font-medium hover:opacity-90 transition-opacity disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed shrink-0"
            >
              Accept →
            </button>
          </div>
        ))}
      </div>

      {error && <p className="text-[12.5px] text-bad mb-3">{error}</p>}

      <div className="border-t border-border pt-4">
        <button
          type="button"
          onClick={onSkip}
          disabled={loading}
          className="w-full font-mono text-[12px] py-[9px] px-3 border border-border rounded-[6px] text-text-muted hover:text-text hover:border-border-strong transition-colors disabled:opacity-40"
        >
          Skip &amp; create my own workspace →
        </button>
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
