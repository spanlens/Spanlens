'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost } from '@/lib/api'
import type { ApiEnvelope } from './types'

/**
 * Internal operator alerts queue (R-Q2 / internal_alerts table).
 *
 * Surfaces Spanlens-wide problems (missing model prices, orphan spans, etc.)
 * to SPANLENS_ADMIN_EMAILS users. Read-only for everyone else; the API
 * returns 403 on access, which we let the page bubble up.
 */

export type AlertKind =
  | 'missing_model_prices'
  | 'orphan_spans'
  | 'fallback_queue_high'
  | 'webhook_backlog'

export type AlertSeverity = 'info' | 'warn' | 'error'

export interface InternalAlert {
  id: string
  kind: AlertKind
  severity: AlertSeverity
  message: string
  details: Record<string, unknown>
  resolved_at: string | null
  resolved_by: string | null
  created_at: string
}

export const internalAlertsKey = (unresolvedOnly: boolean) =>
  ['internal-alerts', { unresolvedOnly }] as const

export function useInternalAlerts(unresolvedOnly = true) {
  return useQuery({
    queryKey: internalAlertsKey(unresolvedOnly),
    queryFn: async () => {
      const path = unresolvedOnly
        ? '/api/v1/admin/alerts?unresolved=true'
        : '/api/v1/admin/alerts?unresolved=false'
      const res = await apiGet<ApiEnvelope<InternalAlert[]>>(path)
      return res.data ?? []
    },
    refetchInterval: 60_000,
  })
}

export function useResolveAlert() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await apiPost(`/api/v1/admin/alerts/${id}/resolve`)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['internal-alerts'] })
    },
  })
}
