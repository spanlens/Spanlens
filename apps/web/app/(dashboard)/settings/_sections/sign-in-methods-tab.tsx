'use client'
import { useEffect, useState } from 'react'
import { formatDate } from '@/lib/utils'
import { Section, FormRow, PrimaryBtn, GhostBtn } from '@/components/ui/primitives'
import { useCurrentUser } from '@/lib/queries/use-current-user'
import {
  useIdentities,
  useLinkIdentity,
  useUnlinkIdentity,
  type LinkableProvider,
} from '@/lib/queries/use-identities'
import type { UserIdentity } from '@supabase/supabase-js'
import { MonoPill, TabHeader } from '../_shared/ui'

// ─── SIGN-IN METHODS tab ──────────────────────────────────────────────────────

interface ProviderConfig {
  id: LinkableProvider
  label: string
  glyph: string
}

const SIGNIN_PROVIDERS: ProviderConfig[] = [
  { id: 'google', label: 'Google', glyph: 'G' },
  { id: 'github', label: 'GitHub', glyph: '⌥' },
]

/**
 * Translates `?error=<code>` query left by /auth/callback after a failed
 * linkIdentity flow into something the user can act on. Codes mirror
 * `mapOAuthError` in apps/web/app/auth/callback/route.ts.
 */
const LINK_ERROR_MESSAGES: Record<string, string> = {
  identity_already_linked:
    'This provider is already connected to your account.',
  identity_linked_to_other_user:
    'This Google or GitHub account is already linked to a different Spanlens user. Use a different provider account, or sign in with that one instead.',
  manual_linking_disabled:
    'Account linking is currently disabled. Please contact support.',
  provider_disabled:
    'This sign-in method is currently unavailable.',
  oauth_callback_failed: 'Connecting the provider failed. Please try again.',
}

export function SignInMethodsTab() {
  const { data: user, isLoading: userLoading } = useCurrentUser()
  const { data: identities, isLoading: identitiesLoading, error: identitiesError } = useIdentities()
  const linkMutation = useLinkIdentity()
  const unlinkMutation = useUnlinkIdentity()
  const [actionError, setActionError] = useState<string | null>(null)

  // Surface failures that happened in /auth/callback (linkIdentity flow
  // round-trips through the provider, so a thrown mutation here can't
  // catch them — the callback redirects back with `?error=<code>`).
  // Same `window.location` pattern as the login page; runs once per
  // mount so cascading-render concerns don't apply.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const code = params.get('error')
    if (!code) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActionError(LINK_ERROR_MESSAGES[code] ?? 'Connecting the provider failed. Please try again.')
    params.delete('error')
    const next = params.toString()
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${next ? `?${next}` : ''}`,
    )
  }, [])

  const identityList: UserIdentity[] = identities ?? []
  const isLastIdentity = identityList.length <= 1
  const isLoading = userLoading || identitiesLoading
  const isBusy = linkMutation.isPending || unlinkMutation.isPending

  function findIdentity(provider: LinkableProvider): UserIdentity | undefined {
    return identityList.find((row) => row.provider === provider)
  }

  async function handleConnect(provider: LinkableProvider) {
    setActionError(null)
    try {
      await linkMutation.mutateAsync({ provider })
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to start sign-in flow.')
    }
  }

  async function handleDisconnect(identity: UserIdentity) {
    setActionError(null)
    try {
      await unlinkMutation.mutateAsync(identity)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to disconnect provider.')
    }
  }

  return (
    <div className="max-w-[920px]">
      <TabHeader
        title="Sign-in methods"
        description="Manage how you sign in to Spanlens. Connect multiple providers to the same account, then sign in with any of them."
      />

      <Section title="Linked providers" className="mb-5">
        {isLoading ? (
          <div className="px-6 py-4 font-mono text-[12.5px] text-text-faint">Loading…</div>
        ) : identitiesError ? (
          <div className="px-6 py-4 font-mono text-[12.5px] text-bad">
            Failed to load identities. Reload the page to try again.
          </div>
        ) : (
          <>
            <FormRow label="Email">
              <div className="flex items-center justify-between gap-3">
                <div className="font-mono text-[12.5px] text-text">{user?.email ?? '—'}</div>
                <MonoPill variant="accent">Primary</MonoPill>
              </div>
            </FormRow>

            {SIGNIN_PROVIDERS.map((provider) => {
              const linked = findIdentity(provider.id)
              const disconnectBlocked = Boolean(linked) && isLastIdentity
              return (
                <FormRow key={provider.id} label={provider.label}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="w-[18px] h-[18px] rounded-[4px] bg-bg-muted flex items-center justify-center font-mono text-[10px] text-text-muted font-bold shrink-0">
                        {provider.glyph}
                      </span>
                      {linked ? (
                        <MonoPill variant="good" dot>
                          Connected
                          {linked.last_sign_in_at
                            ? ` · last used ${formatDate(linked.last_sign_in_at)}`
                            : ''}
                        </MonoPill>
                      ) : (
                        <MonoPill variant="faint" dot>Not connected</MonoPill>
                      )}
                    </div>
                    {linked ? (
                      <GhostBtn
                        onClick={() => void handleDisconnect(linked)}
                        disabled={isBusy || disconnectBlocked}
                        title={disconnectBlocked ? 'Connect another sign-in method before removing this one.' : undefined}
                      >
                        Disconnect
                      </GhostBtn>
                    ) : (
                      <PrimaryBtn
                        onClick={() => void handleConnect(provider.id)}
                        disabled={isBusy}
                      >
                        Connect
                      </PrimaryBtn>
                    )}
                  </div>
                </FormRow>
              )
            })}
          </>
        )}

        {actionError && (
          <div className="px-6 py-3 border-t border-border text-[12.5px] text-bad">
            {actionError}
          </div>
        )}
      </Section>

      <Section title="Why connect multiple providers?" className="mb-5">
        <div className="px-6 py-4 text-[13px] text-text-muted leading-relaxed space-y-2">
          <p>
            One account, multiple ways in. Connect Google or GitHub to sign in faster the
            next time and keep email as a fallback if a provider is unavailable.
          </p>
          <p>
            Spanlens never receives your provider password. Disconnecting a provider
            removes its OAuth token from this account immediately and cannot be undone
            from the provider&apos;s side.
          </p>
        </div>
      </Section>
    </div>
  )
}
