'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api'
import type {
  ApiEnvelope,
  WebhookDeliveryRow,
  WebhookEvent,
  WebhookRow,
} from './types'

const webhooksKey = ['webhooks'] as const

function deliveriesKey(webhookId: string) {
  return ['webhooks', webhookId, 'deliveries'] as const
}

// ── Webhooks CRUD ──────────────────────────────────────────────

export function useWebhooks() {
  return useQuery({
    queryKey: webhooksKey,
    queryFn: async () => {
      const res = await apiGet<ApiEnvelope<WebhookRow[]>>('/api/v1/webhooks')
      return res.data
    },
  })
}

export function useCreateWebhook() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      name: string
      url: string
      events: WebhookEvent[]
      is_active?: boolean
    }) => {
      const res = await apiPost<ApiEnvelope<WebhookRow>>('/api/v1/webhooks', input)
      return res.data
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: webhooksKey }),
  })
}

export function useUpdateWebhook() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      id: string
      name?: string
      url?: string
      events?: WebhookEvent[]
      is_active?: boolean
    }) => {
      const { id, ...body } = input
      const res = await apiPatch<ApiEnvelope<WebhookRow>>(`/api/v1/webhooks/${id}`, body)
      return res.data
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: webhooksKey }),
  })
}

export function useDeleteWebhook() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await apiDelete(`/api/v1/webhooks/${id}`)
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: webhooksKey }),
  })
}

export function useTestWebhook() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiPost<
        ApiEnvelope<{
          status: 'success' | 'failed'
          http_status: number | null
          error_message: string | null
          duration_ms: number
        }>
      >(`/api/v1/webhooks/${id}/test`, {})
      return res.data
    },
    onSuccess: (_data, id) => {
      void qc.invalidateQueries({ queryKey: deliveriesKey(id) })
    },
  })
}

// ── Delivery history ───────────────────────────────────────────

export function useWebhookDeliveries(webhookId: string | null) {
  return useQuery({
    queryKey: webhookId ? deliveriesKey(webhookId) : ['webhooks', null, 'deliveries'],
    enabled: webhookId !== null,
    queryFn: async () => {
      const res = await apiGet<ApiEnvelope<WebhookDeliveryRow[]>>(
        `/api/v1/webhooks/${webhookId!}/deliveries`,
      )
      return res.data
    },
  })
}
