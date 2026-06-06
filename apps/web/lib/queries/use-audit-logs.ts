'use client'

import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import type { ApiEnvelope } from './types'

export interface AuditLogRow {
  id: string
  action: string
  resource_type: string
  resource_id: string | null
  user_id: string | null
  metadata: Record<string, unknown> | null
  ip_address: string | null
  created_at: string
}

export interface AuditLogMeta {
  total: number
  limit: number
  offset: number
}

/**
 * Query parameters for the audit log listing.
 *
 * `from` / `to` are inclusive ISO strings; the server rejects malformed
 * values with 400. `userId` filters to a specific actor; `action` matches
 * the action column exactly (use {@link useAuditLogActions} to populate a
 * dropdown of valid values for this org).
 */
export interface UseAuditLogsParams {
  limit?: number
  offset?: number
  action?: string
  userId?: string
  from?: string
  to?: string
}

function paramsToQueryString(params: UseAuditLogsParams): string {
  const qs = new URLSearchParams()
  if (params.limit) qs.set('limit', String(params.limit))
  if (params.offset) qs.set('offset', String(params.offset))
  if (params.action) qs.set('action', params.action)
  if (params.userId) qs.set('user_id', params.userId)
  if (params.from) qs.set('from', params.from)
  if (params.to) qs.set('to', params.to)
  return qs.size > 0 ? `?${qs}` : ''
}

/**
 * Legacy shape: just the rows. Existing call sites (dashboard preview,
 * settings tab) used this signature and only care about the array. Keep
 * this as the default for backward compatibility.
 */
export function useAuditLogs(params: UseAuditLogsParams = {}) {
  return useQuery({
    queryKey: ['audit-logs', params] as const,
    queryFn: async () => {
      const suffix = paramsToQueryString(params)
      const res = await apiGet<ApiEnvelope<AuditLogRow[]>>(`/api/v1/audit-logs${suffix}`)
      return res.data ?? []
    },
    staleTime: 30_000,
  })
}

/**
 * Full envelope: rows + pagination meta (total, limit, offset). Used by
 * the dedicated /settings/audit-logs viewer that needs to render
 * "Showing 1-50 of 1234".
 *
 * `enabled` is exposed so callers can gate the request on a permission
 * check (the dedicated viewer skips it for non-admins) without breaking
 * the rules-of-hooks order.
 */
export function useAuditLogsPage(
  params: UseAuditLogsParams = {},
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: ['audit-logs', 'page', params] as const,
    queryFn: async () => {
      const suffix = paramsToQueryString(params)
      const res = await apiGet<ApiEnvelope<AuditLogRow[]> & { meta?: AuditLogMeta }>(
        `/api/v1/audit-logs${suffix}`,
      )
      return {
        rows: res.data ?? [],
        meta: res.meta ?? { total: 0, limit: params.limit ?? 50, offset: params.offset ?? 0 },
      }
    },
    staleTime: 15_000,
    enabled: options.enabled ?? true,
  })
}

/**
 * Distinct actions seen on the org. Populates the filter dropdown.
 */
export function useAuditLogActions() {
  return useQuery({
    queryKey: ['audit-logs', 'actions'] as const,
    queryFn: async () => {
      const res = await apiGet<ApiEnvelope<string[]>>('/api/v1/audit-logs/actions')
      return res.data ?? []
    },
    staleTime: 5 * 60_000,
  })
}
