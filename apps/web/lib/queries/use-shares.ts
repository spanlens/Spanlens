'use client'

import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { apiDelete, apiGet } from '@/lib/api'

/**
 * R-26 + R-33 Sprint 6 — workspace dashboard for public share links.
 *
 * The API endpoint is GET /api/v1/shares from PR #270's predecessor;
 * Sprint 6 extends it to accept `?scope=org&sort=...` so the dashboard
 * can show every active share in the workspace (matches the DELETE
 * handler's policy — any member can revoke any share in their org).
 */

export type ShareSort = 'created' | 'views' | 'expires_soon'
export type ShareScopeFilter = 'mine' | 'org'

export interface ShareRow {
  id: string
  token: string
  scope: 'trace' | 'request'
  target_id: string
  /** Server-side enrichment: trace.name when available, "<Scope> <short>" otherwise. */
  target_label: string
  target_name: string | null
  expires_at: string | null
  redact_pii: boolean
  redact_cost: boolean
  redact_tokens: boolean
  indexable: boolean
  view_count: number
  revoked_at: string | null
  created_at: string
  created_by: string | null
}

interface SharesListResponse {
  success: boolean
  data: ShareRow[]
}

interface UseSharesInput {
  scope?: ShareScopeFilter
  sort?: ShareSort
  includeRevoked?: boolean
}

function buildQueryString(input: UseSharesInput): string {
  const params = new URLSearchParams()
  if (input.scope) params.set('scope', input.scope)
  if (input.sort) params.set('sort', input.sort)
  if (input.includeRevoked) params.set('include', 'revoked')
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

export function useShares(input: UseSharesInput = {}) {
  const qs = buildQueryString(input)
  return useQuery({
    queryKey: ['shares', input.scope ?? 'mine', input.sort ?? 'created', input.includeRevoked ?? false],
    queryFn: () => apiGet<SharesListResponse>(`/api/v1/shares${qs}`),
    select: (response) => response.data,
    // Workspace dashboards refresh on focus — the user just clicked over from
    // creating a share in another tab and the list should reflect it.
    refetchOnWindowFocus: true,
  })
}

export function useRevokeShare() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (token: string) =>
      apiDelete<{ success: boolean }>(`/api/v1/shares/${encodeURIComponent(token)}`),
    onSuccess: () => {
      // Invalidate every shares query key — any scope/sort/include combo the
      // user has open should re-fetch so the revoked row drops out.
      queryClient.invalidateQueries({ queryKey: ['shares'] })
    },
  })
}
