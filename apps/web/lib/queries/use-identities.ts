'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UserIdentity } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'

export const identitiesQueryKey = ['identities'] as const

/**
 * Provider keys that we expose in the UI. Keep this in sync with the
 * providers enabled in the Supabase Dashboard. Anything else returned
 * by `getUserIdentities()` (e.g. magic-link `email` rows) is rendered
 * as-is using the raw provider string.
 */
export type LinkableProvider = 'google' | 'github'

/**
 * All identities linked to the current Supabase user. One row per
 * provider — a user who signed up via Google can later link GitHub
 * (or email/password) here, and `data` will then contain multiple rows.
 *
 * Returns `null` only when there is no signed-in user. An empty array
 * is unusual but possible right after sign-up and before the first
 * identity is committed; callers should treat it as "no identities yet".
 */
export function useIdentities() {
  return useQuery({
    queryKey: identitiesQueryKey,
    queryFn: async (): Promise<UserIdentity[] | null> => {
      const supabase = createClient()
      const { data, error } = await supabase.auth.getUserIdentities()
      if (error) throw error
      return data?.identities ?? null
    },
    staleTime: 60_000,
  })
}

interface LinkIdentityVariables {
  provider: LinkableProvider
  /**
   * Where to land after the provider OAuth flow + our `/auth/callback`
   * complete. Default: back to the Sign-in methods tab so the user
   * sees the freshly linked provider appear without hunting.
   */
  redirectPath?: string
}

/**
 * Cookie used to remember the page that started a linkIdentity flow.
 * `/auth/callback` reads + clears it on return. We use a cookie rather
 * than `?next=` on the redirectTo URL because Supabase's redirect URL
 * allowlist matches against the base URL — wildcards (and even some
 * exact entries) reject a URL with `?query` appended, which causes
 * Supabase to fall back to the project Site URL and dump the user on
 * the marketing home page instead of /settings.
 */
const OAUTH_RETURN_COOKIE = 'sl_oauth_return'

/**
 * Start the OAuth flow to attach an additional provider to the
 * currently signed-in user. The browser is redirected to the provider;
 * after consent it hits `/auth/v1/callback` → our `/auth/callback`,
 * which calls `exchangeCodeForSession` and adds the new identity to
 * the existing user record (no new user row created).
 *
 * We stash the desired return path in a short-lived cookie so the
 * server callback can route the user back to where they started.
 */
export function useLinkIdentity() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      provider,
      redirectPath = '/settings?tab=auth-methods',
    }: LinkIdentityVariables) => {
      // 5-minute lifetime is plenty for a provider round-trip and short
      // enough to not pollute the cookie jar if the user abandons the
      // flow. SameSite=Lax so the cookie survives the cross-site OAuth
      // bounce (Strict would drop it on return).
      if (typeof document !== 'undefined') {
        document.cookie = `${OAUTH_RETURN_COOKIE}=${encodeURIComponent(redirectPath)}; path=/; max-age=300; samesite=lax`
      }
      const supabase = createClient()
      const { data, error } = await supabase.auth.linkIdentity({
        provider,
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: identitiesQueryKey })
    },
  })
}

/**
 * Remove a linked identity. Callers must guard against removing the
 * user's last sign-in method — Supabase will reject it, but the UI
 * should not even surface the button in that case (better UX than a
 * failed mutation toast).
 */
export function useUnlinkIdentity() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (identity: UserIdentity) => {
      const supabase = createClient()
      const { error } = await supabase.auth.unlinkIdentity(identity)
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: identitiesQueryKey })
    },
  })
}
