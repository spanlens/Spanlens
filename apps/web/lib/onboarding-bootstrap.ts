'use client'

import { writeWelcomeStash } from './welcome-stash'
import { writeWorkspaceCookie } from './workspace-cookie'

/** Shape of `POST /api/v1/organizations/bootstrap` fields onboarding uses. */
export interface BootstrapResponse {
  data?: {
    apiKey?: string
    userId?: string
    organization?: { id?: string }
  }
}

/**
 * Client-side follow-up to a successful workspace bootstrap. `null` means the
 * server answered 409 "already onboarded", which needs no follow-up.
 *
 *   1. Stash the one-time API key, bound to the userId from the same response,
 *      so a logout-without-dismiss can't surface it to whoever signs in next
 *      on this tab (see welcome-stash.ts for the contract).
 *   2. Point the `sb-ws` workspace cookie at the new workspace. The server's
 *      auth cache is keyed by token plus this cookie, so the dashboard's first
 *      API calls resolve the new workspace on every server instance instead of
 *      reusing a cache key from before the workspace existed. The invitation
 *      accept path does the same before its hard navigation.
 */
export function applyBootstrapResult(res: BootstrapResponse | null): void {
  const data = res?.data
  if (!data) return
  if (data.apiKey && data.userId) writeWelcomeStash(data.apiKey, data.userId)
  const orgId = data.organization?.id
  if (orgId) writeWorkspaceCookie(orgId)
}
