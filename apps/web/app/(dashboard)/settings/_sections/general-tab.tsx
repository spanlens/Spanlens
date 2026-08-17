'use client'
import { useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { Section, FormRow, GhostBtn } from '@/components/ui/primitives'
import {
  useOrganization,
  useUpdateOrganization,
  useUpdateBrandingSettings,
  useUpdateLoggingSettings,
} from '@/lib/queries/use-organization'
import { useCurrentMember } from '@/lib/queries/use-members'
import { NativeInput, MonoPill, Toggle, TabHeader, PILL_SECONDARY } from '../_shared/ui'

// ─── GENERAL tab ─────────────────────────────────────────────────────────────

export function GeneralTab() {
  const { data: org } = useOrganization()
  const updateOrg = useUpdateOrganization()
  const [name, setName] = useState(org?.name ?? '')
  const [nameError, setNameError] = useState<string | null>(null)
  const currentMember = useCurrentMember()
  const isAdmin = currentMember?.role === 'admin'

  async function handleSaveName() {
    if (!org) return
    setNameError(null)
    try {
      await updateOrg.mutateAsync({ id: org.id, name })
    } catch (err) {
      setNameError(err instanceof Error ? err.message : 'Update failed')
    }
  }
  // useSyncExternalStore returns false on the server and true on the client
  // without needing useEffect + setState (avoids react-hooks/set-state-in-effect).
  const mounted = useSyncExternalStore(
    (_cb) => () => {},
    () => true,
    () => false,
  )

  const plan = mounted ? org?.plan : undefined
  const retention = plan === 'team' ? '90 days'
    : plan === 'starter' ? '30 days'
    : plan === 'enterprise' ? '1 year'
    : '7 days'
  const timezone = mounted ? Intl.DateTimeFormat().resolvedOptions().timeZone : '—'

  return (
    <div>
      <TabHeader
        title="General"
        description="Workspace identity, storage region, and retention."
      />

      <Section title="Identity" description="Visible within your workspace" className="mb-4">
        <FormRow label="Workspace name" hint="Shown in the app header and on shared traces.">
          <div className="flex flex-col gap-2 w-full max-w-[460px]">
            <div className="flex items-center gap-3">
              <NativeInput
                value={name || (org?.name ?? '')}
                onChange={(e) => setName(e.target.value)}
                className="flex-1 font-mono text-[12.5px]"
                disabled={!isAdmin}
              />
              {isAdmin && (
                <GhostBtn
                  className={PILL_SECONDARY}
                  disabled={updateOrg.isPending || !name.trim() || name === org?.name}
                  onClick={() => void handleSaveName()}
                >
                  {updateOrg.isPending ? 'Saving…' : 'Save'}
                </GhostBtn>
              )}
            </div>
            {nameError && (
              <span className="font-mono text-[11.5px] text-bad">{nameError}</span>
            )}
          </div>
        </FormRow>
        <FormRow label="Plan">
          <MonoPill variant={plan === 'enterprise' ? 'good' : 'accent'} dot>
            {plan ?? '—'}
          </MonoPill>
        </FormRow>
      </Section>

      {isAdmin && <BrandingSection plan={plan ?? null} hideBadge={org?.hide_powered_by_badge ?? false} />}
      {org && <EmbedBadgeSection orgId={org.id} />}

      <Section title="Data retention" description="Log retention is determined by your plan" className="mb-4">
        <FormRow label="Current retention">
          <div className="font-mono text-[12.5px] text-text-muted">
            {retention}
            <span className="ml-2 text-text-faint">· {plan ?? 'free'} plan</span>
          </div>
        </FormRow>
        <FormRow label="Timestamps" hint="All timestamps in the UI use your browser's local timezone.">
          <div className="font-mono text-[12.5px] text-text-muted">
            {timezone}
          </div>
        </FormRow>
      </Section>

      {isAdmin && org && <LoggingSection currentRate={org.body_sample_rate ?? 1} />}

      <Section title="Delete workspace" description="Contact support to delete your workspace" className="mb-4">
        <div className="px-6 py-4 text-[12.5px] text-text-muted leading-relaxed">
          Workspace deletion requires verification and isn&apos;t available in the self-service UI yet.
          Email <span className="font-mono text-text">support@spanlens.io</span> from the owner address
          and we&apos;ll purge data and cancel billing within one business day.
        </div>
      </Section>
    </div>
  )
}

// ─── Log body sampling (ClickHouse storage control) ──────────────────────────

function LoggingSection({ currentRate }: { currentRate: number }) {
  const update = useUpdateLoggingSettings()
  const [error, setError] = useState<string | null>(null)

  async function handleChange(value: string) {
    setError(null)
    try {
      await update.mutateAsync({ body_sample_rate: Number(value) })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed')
    }
  }

  // Snap the stored rate to the nearest preset so the dropdown shows a match.
  const presets = [1, 0.5, 0.1, 0.01]
  const selected = presets.reduce(
    (best, p) => (Math.abs(p - currentRate) < Math.abs(best - currentRate) ? p : best),
    1,
  )

  return (
    <Section
      title="Log body sampling"
      description="Cut ClickHouse storage by keeping prompt and response bodies for only a fraction of requests. Token counts, cost, and billing are always recorded in full."
      className="mb-4"
    >
      <FormRow
        label="Store bodies for"
        hint="Every request still writes a row with tokens and cost. Only the prompt/response text is sampled, so sampled-out requests show empty bodies in /requests."
      >
        <div className="flex items-center gap-3">
          <select
            value={String(selected)}
            disabled={update.isPending}
            onChange={(e) => void handleChange(e.currentTarget.value)}
            className="rounded-md border border-border bg-bg-elev px-3 py-2 text-[12.5px] font-medium text-text"
          >
            <option value="1">100% of requests (store all)</option>
            <option value="0.5">50% of requests</option>
            <option value="0.1">10% of requests</option>
            <option value="0.01">1% of requests</option>
          </select>
          {error && <span className="text-[12px] text-bad">{error}</span>}
        </div>
      </FormRow>
    </Section>
  )
}

// ─── Branding (share footer) — PLG Loop ② ────────────────────────────────────

function BrandingSection({ plan, hideBadge }: { plan: string | null; hideBadge: boolean }) {
  const update = useUpdateBrandingSettings()
  const canHide = plan === 'team' || plan === 'enterprise'
  const [error, setError] = useState<string | null>(null)

  async function handleToggle() {
    setError(null)
    try {
      await update.mutateAsync({ hide_powered_by_badge: !hideBadge })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed')
    }
  }

  return (
    <Section
      title="Share branding"
      description='Public share pages show an "Observed by Spanlens" footer.'
      className="mb-4"
    >
      <FormRow
        label="Hide Spanlens footer"
        hint={
          canHide
            ? 'Removes the footer from /share/<token> pages your workspace creates.'
            : 'Available on the Team plan. The footer is part of how we keep Free and Starter sustainable.'
        }
      >
        <div className="flex items-center gap-3">
          <Toggle
            on={canHide && hideBadge}
            disabled={!canHide || update.isPending}
            onToggle={handleToggle}
          />
          {!canHide && (
            <Link
              href="/settings?tab=plan"
              className="font-mono text-[11.5px] text-accent hover:opacity-80"
            >
              Upgrade →
            </Link>
          )}
        </div>
      </FormRow>
      {error && (
        <div className="px-6 pb-4 -mt-2 font-mono text-[11.5px] text-bad">
          {error}
        </div>
      )}
    </Section>
  )
}

// ─── Embed badge (README SVG) — PLG Loop ③ ───────────────────────────────────

function EmbedBadgeSection({ orgId }: { orgId: string }) {
  // Snippet always points at the canonical production domain so users don't
  // accidentally paste a localhost URL into their README during local dev.
  const snippetUrl = `https://www.spanlens.io/badge/${orgId}.svg`
  const markdown = `[![Observed by Spanlens](${snippetUrl})](https://www.spanlens.io)`
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(markdown)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Older browsers / non-secure contexts — fall through silently. User can
      // still select-all manually.
    }
  }

  return (
    <Section
      title="README badge"
      description="Show off Spanlens observability on your repo. Paste this snippet into your project's README."
      className="mb-4"
    >
      <FormRow label="Markdown" hint="Renders as the badge above on GitHub, GitLab, and npm.">
        <div className="flex flex-col gap-2 w-full max-w-[640px]">
          <div className="flex items-center gap-3">
            {/* Preview uses same-origin so devs see the actual rendered SVG
                even before the change ships to production. Plain <img> is
                deliberate — next/image is overkill for a 148x20 static SVG
                served straight from the server with long cache headers. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/badge/${orgId}.svg`}
              alt="Observed by Spanlens"
              width={148}
              height={20}
              className="h-5"
            />
          </div>
          <textarea
            readOnly
            value={markdown}
            onFocus={(e) => e.currentTarget.select()}
            className="w-full rounded-md border border-border bg-bg-sunk px-3 py-2 font-mono text-[11.5px] text-text resize-none focus:outline-none focus:border-border-strong"
            rows={2}
          />
          <div className="flex">
            <GhostBtn className={PILL_SECONDARY} onClick={copy}>
              {copied ? 'Copied' : 'Copy markdown'}
            </GhostBtn>
          </div>
        </div>
      </FormRow>
    </Section>
  )
}
