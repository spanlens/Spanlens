'use client'
import { useState } from 'react'

import { apiPost } from '@/lib/api'
import {
  useAcceptPendingInvitation,
  usePendingInvitations,
  type PendingInvitation,
} from '@/lib/queries/use-pending-invitations'
import { writeWorkspaceCookie } from '@/lib/workspace-cookie'
import { writeWelcomeStash } from '@/lib/welcome-stash'
import { TrackOnce } from '@/components/track-once'
import { cn } from '@/lib/utils'
import {
  AuthFootnote,
  AuthLayout,
  AuthNote,
  authInput,
  authPrimaryButton,
  authSecondaryButton,
} from '../auth/_components/auth-shell'

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
    userId?: string
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
  // Once the user advances past the initial step, `manualStep` takes over.
  // Before that, we derive the initial step from the pending-invitations
  // fetch — no setState-in-effect required.
  const [manualStep, setStep] = useState<Step | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const pending = usePendingInvitations()
  const acceptInvite = useAcceptPendingInvitation()

  const step: Step | null = manualStep
    ?? (pending.isFetched
      ? ((pending.data?.length ?? 0) > 0 ? 'pending' : 'workspace')
      : null)

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

      // Bind the cached key to the userId from the same bootstrap response
      // so a logout-without-dismiss can't surface this key to whoever signs
      // in next on the same tab. See lib/welcome-stash.ts for the contract.
      if (res?.data?.apiKey && res.data.userId) {
        writeWelcomeStash(res.data.apiKey, res.data.userId)
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
    <AuthLayout
      pitch={{
        title: 'Two minutes to first trace.',
        body: 'Tell us where you ship, then paste one line into your client. The dashboard fills itself.',
      }}
    >
      {/* Funnel event: account exists and the user reached onboarding —
          the single point every signup path (email, email-confirm, OAuth)
          converges on. Once per browser so revisits don't recount. */}
      <TrackOnce event="signup_completed" scope="local" />

      {showStepper && <Stepper currentIdx={stepperIdx} />}

      {step === null && (
        <p className="text-[13.5px] leading-[1.6] text-text-faint" role="status">
          Loading…
        </p>
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
          <h1 className="font-display track-h3 text-[24px] leading-[1.2] text-text">Name your workspace</h1>
          <p className="mb-5 mt-2 text-[13.5px] leading-[1.6] text-text-faint">
            Usually your company or team name. You can change it later in Settings.
          </p>

          <label htmlFor="workspace-name" className="mb-[7px] block text-[12.5px] font-medium leading-[1.48] text-text">
            Workspace name
          </label>
          <input
            id="workspace-name"
            type="text"
            autoFocus
            value={workspaceName}
            onChange={(e) => setWorkspaceName(e.target.value)}
            placeholder="Acme Inc."
            maxLength={80}
            aria-invalid={error ? true : undefined}
            className={authInput}
          />

          {error && <AuthNote tone="bad" live="assertive" className="mt-4">{error}</AuthNote>}

          <button
            type="submit"
            disabled={loading || !workspaceName.trim()}
            className={`${authPrimaryButton} mt-[22px]`}
          >
            {loading ? 'Creating workspace…' : 'Continue'}
          </button>
        </form>
      )}

      {step === 'survey' && (
        <div>
          <h1 className="font-display track-h3 text-[24px] leading-[1.2] text-text">
            Tell us about your project
          </h1>
          <p className="mb-5 mt-2 text-[13.5px] leading-[1.6] text-text-faint">
            Helps us prioritise what to build. Both questions are optional.
          </p>

          <div className="flex flex-col gap-4">
            <OptionGroup label="What are you building?">
              {USE_CASES.map((opt) => (
                <Chip
                  key={opt.id}
                  checked={useCase === opt.id}
                  onClick={() => setUseCase(useCase === opt.id ? null : opt.id)}
                  label={opt.label}
                  {...(opt.hint ? { hint: opt.hint } : {})}
                />
              ))}
            </OptionGroup>

            <OptionGroup label="What is your role?">
              {ROLES.map((opt) => (
                <Chip
                  key={opt.id}
                  checked={role === opt.id}
                  onClick={() => setRole(role === opt.id ? null : opt.id)}
                  label={opt.label}
                />
              ))}
            </OptionGroup>
          </div>

          {error && <AuthNote tone="bad" live="assertive" className="mt-4">{error}</AuthNote>}

          <button
            type="button"
            onClick={() => void completeSurvey(true)}
            disabled={loading || (!useCase && !role)}
            className={`${authPrimaryButton} mt-6`}
          >
            {loading ? 'Saving…' : 'Continue to the snippet'}
          </button>

          <button
            type="button"
            onClick={() => void completeSurvey(false)}
            disabled={loading}
            className={`${authSecondaryButton} mt-2.5`}
          >
            Skip, I will connect later
          </button>
        </div>
      )}
    </AuthLayout>
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
  const many = invitations.length !== 1
  return (
    <div>
      <h1 className="font-display track-h3 text-[24px] leading-[1.2] text-text">Someone saved you a seat</h1>
      <p className="mb-5 mt-2 text-[13.5px] leading-[1.6] text-text-faint">
        You have an open invitation to {many ? 'these workspaces' : 'a workspace'}. Join now, or skip and
        create your own.
      </p>

      <ul className="flex flex-col gap-2.5">
        {invitations.map((inv) => (
          <li
            key={inv.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-border bg-bg-elev px-3.5 py-3"
          >
            <span className="flex min-w-0 items-center gap-3">
              <span
                className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-bg text-[14px] font-semibold text-accent"
                aria-hidden="true"
              >
                {inv.orgName.slice(0, 2).toUpperCase()}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[13.5px] font-semibold leading-[1.48] text-text">
                  {inv.orgName}
                </span>
                <span className="block font-mono text-[12px] leading-[1.48] text-text-faint">
                  joins as {inv.role}
                </span>
              </span>
            </span>
            <button
              type="button"
              onClick={() => onAccept(inv)}
              disabled={loading}
              className="inline-flex h-9 shrink-0 items-center rounded-full bg-accent px-4 text-[12.5px] font-semibold text-accent-fg transition-colors hover:bg-accent-strong disabled:pointer-events-none disabled:opacity-50"
            >
              Accept
            </button>
          </li>
        ))}
      </ul>

      {error && <AuthNote tone="bad" live="assertive" className="mt-4">{error}</AuthNote>}

      <button type="button" onClick={onSkip} disabled={loading} className={`${authSecondaryButton} mt-5`}>
        Create my own workspace instead
      </button>

      <AuthFootnote className="mt-4">
        Joining does not touch any workspace you already own.
      </AuthFootnote>
    </div>
  )
}

/*
 * Numbered progress row from the A10 board. Completed and current steps take
 * the ink fill; anything ahead sits on the neutral track so the row reads as
 * a path rather than as three equal buttons.
 */
function Stepper({ currentIdx }: { currentIdx: number }) {
  const labels = ['Workspace', 'About you']
  return (
    <ol className="mb-[22px] flex items-center gap-2">
      {labels.map((label, i) => {
        const isReached = i <= currentIdx
        return (
          <li key={label} className="flex items-center gap-2">
            <span className="flex items-center gap-[7px]">
              <span
                className={cn(
                  'flex size-5 items-center justify-center rounded-full font-mono text-[10.5px]',
                  isReached ? 'bg-text text-bg' : 'bg-track text-text-faint',
                )}
                aria-hidden="true"
              >
                {i < currentIdx ? '✓' : i + 1}
              </span>
              <span
                className={cn(
                  'text-[12px] leading-[1.48]',
                  isReached ? 'font-semibold text-text' : 'font-medium text-text-faint',
                )}
                {...(i === currentIdx ? { 'aria-current': 'step' as const } : {})}
              >
                {label}
              </span>
            </span>
            {i < labels.length - 1 && <span className="h-px w-6 bg-border" aria-hidden="true" />}
          </li>
        )
      })}
    </ol>
  )
}

function OptionGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <fieldset className="m-0 border-0 p-0">
      <legend className="mb-[9px] text-[12.5px] font-medium leading-[1.48] text-text">{label}</legend>
      <div className="flex flex-wrap gap-2">{children}</div>
    </fieldset>
  )
}

/* Toggle pill. `aria-pressed` carries the selection to assistive tech, since
   the selected state is otherwise only a fill change. */
function Chip({
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
      aria-pressed={checked}
      {...(hint ? { title: hint } : {})}
      className={cn(
        'rounded-full px-3 py-2 text-[12px] font-medium leading-[1.48] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg-elev',
        checked
          ? 'bg-text text-bg'
          : 'border border-border bg-bg-elev text-text hover:border-border-strong hover:bg-bg-muted',
      )}
    >
      {label}
    </button>
  )
}

