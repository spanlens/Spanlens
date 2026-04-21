'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost } from '@/lib/api'
import type {
  ApiEnvelope,
  BillingPlan,
  CheckoutResponse,
  Subscription,
} from './types'

export interface QuotaStatus {
  allowed: boolean
  usedThisMonth: number
  limit: number | null
  plan: BillingPlan
}

export const quotaQueryKey = ['billing', 'quota'] as const

export function useQuota() {
  return useQuery({
    queryKey: quotaQueryKey,
    queryFn: async () => {
      const res = await apiGet<ApiEnvelope<QuotaStatus>>('/api/v1/billing/quota')
      return res.data
    },
    staleTime: 30_000,
  })
}

export const subscriptionQueryKey = ['billing', 'subscription'] as const

/**
 * Current active subscription (null = free plan).
 * Refetches on focus so the UI stays in sync after the user returns from the
 * Paddle hosted checkout page.
 */
export function useSubscription() {
  return useQuery({
    queryKey: subscriptionQueryKey,
    queryFn: async () => {
      const res = await apiGet<ApiEnvelope<Subscription | null>>(
        '/api/v1/billing/subscription',
      )
      return res.data
    },
    refetchOnWindowFocus: true,
  })
}

/**
 * Kick off a checkout for an upgrade. On success the caller should redirect
 * `window.location.href` to the returned Paddle URL.
 */
export function useCreateCheckout() {
  return useMutation({
    mutationFn: async (input: {
      plan: Exclude<BillingPlan, 'free' | 'enterprise'>
      successUrl?: string
    }) => {
      const res = await apiPost<ApiEnvelope<CheckoutResponse>>(
        '/api/v1/billing/checkout',
        input,
      )
      return res.data
    },
  })
}

/** Local helper — called after the user returns from Paddle checkout. */
export function useRefreshSubscription() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: subscriptionQueryKey })
  }
}
