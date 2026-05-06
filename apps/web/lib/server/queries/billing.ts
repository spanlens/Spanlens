import 'server-only'
import { apiGetServer } from '@/lib/server/api'
import type { ApiEnvelope, Subscription } from '@/lib/queries/types'
import type { QuotaStatus } from '@/lib/queries/use-billing'
import type { QuerySpec } from '@/lib/server/dehydrate'

// Must exactly match subscriptionQueryKey in use-billing.ts
const subscriptionQK = ['billing', 'subscription'] as const

// Must exactly match quotaQueryKey in use-billing.ts
const quotaQK = ['billing', 'quota'] as const

export function subscriptionSpec(): QuerySpec {
  return {
    queryKey: subscriptionQK,
    queryFn: async () => {
      const res = await apiGetServer<ApiEnvelope<Subscription | null>>(
        '/api/v1/billing/subscription',
      )
      return res.data
    },
  }
}

export function quotaSpec(): QuerySpec {
  return {
    queryKey: quotaQK,
    queryFn: async () => {
      const res = await apiGetServer<ApiEnvelope<QuotaStatus>>('/api/v1/billing/quota')
      return res.data
    },
    staleTime: 30_000,
  }
}
