'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPatch } from '@/lib/api'
import type { ApiEnvelope, Organization } from './types'

export const organizationQueryKey = ['organization'] as const

export function useOrganization() {
  return useQuery({
    queryKey: organizationQueryKey,
    queryFn: async () => {
      const res = await apiGet<ApiEnvelope<Organization>>('/api/v1/organizations/me')
      return res.data
    },
  })
}

export function useUpdateOrganization() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const res = await apiPatch<ApiEnvelope<Organization>>(`/api/v1/organizations/${id}`, { name })
      return res.data
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: organizationQueryKey })
    },
  })
}

export interface OverageSettingsUpdate {
  allow_overage?: boolean
  overage_cap_multiplier?: number
}

/**
 * PATCH /api/v1/organizations/me/overage — Pattern C overage policy controls.
 * Invalidates the org cache + the quota cache (since allowed may flip).
 */
export function useUpdateOverageSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (update: OverageSettingsUpdate) => {
      const res = await apiPatch<ApiEnvelope<Organization>>(
        '/api/v1/organizations/me/overage',
        update,
      )
      return res.data
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: organizationQueryKey })
      void qc.invalidateQueries({ queryKey: ['billing', 'quota'] })
    },
  })
}

export interface SecuritySettingsUpdate {
  stale_key_alerts_enabled?: boolean
  stale_key_threshold_days?: number
  leak_detection_enabled?: boolean
}

/**
 * PATCH /api/v1/organizations/me/security — notification-only key security
 * settings (stale-key digest, GitGuardian leak detection). Neither auto-revokes
 * keys; both are pure email notifications.
 */
export function useUpdateSecuritySettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (update: SecuritySettingsUpdate) => {
      const res = await apiPatch<ApiEnvelope<Organization>>(
        '/api/v1/organizations/me/security',
        update,
      )
      return res.data
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: organizationQueryKey })
    },
  })
}
