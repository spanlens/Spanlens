'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api'
import type {
  AlertDeliveryRow,
  AlertRow,
  AlertType,
  ApiEnvelope,
  ChannelKind,
  NotificationChannelRow,
} from './types'

export const alertsKey = ['alerts'] as const
export const channelsKey = ['alerts', 'channels'] as const
export const deliveriesKey = ['alerts', 'deliveries'] as const

// ── Alerts CRUD ────────────────────────────────────────────────

export function useAlerts() {
  return useQuery({
    queryKey: alertsKey,
    queryFn: async () => {
      const res = await apiGet<ApiEnvelope<AlertRow[]>>('/api/v1/alerts')
      return res.data
    },
  })
}

export function useCreateAlert() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      name: string
      type: AlertType
      threshold: number
      window_minutes?: number
      cooldown_minutes?: number
      project_id?: string
    }) => {
      const res = await apiPost<ApiEnvelope<AlertRow>>('/api/v1/alerts', input)
      return res.data
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: alertsKey }),
  })
}

export function useUpdateAlert() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      id: string
      name?: string
      threshold?: number
      window_minutes?: number
      cooldown_minutes?: number
      is_active?: boolean
    }) => {
      const { id, ...body } = input
      const res = await apiPatch<ApiEnvelope<AlertRow>>(`/api/v1/alerts/${id}`, body)
      return res.data
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: alertsKey }),
  })
}

export function useDeleteAlert() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await apiDelete(`/api/v1/alerts/${id}`)
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: alertsKey }),
  })
}

// ── Channels CRUD ──────────────────────────────────────────────

export function useNotificationChannels() {
  return useQuery({
    queryKey: channelsKey,
    queryFn: async () => {
      const res = await apiGet<ApiEnvelope<NotificationChannelRow[]>>(
        '/api/v1/alerts/channels',
      )
      return res.data
    },
  })
}

export function useCreateChannel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { kind: ChannelKind; target: string }) => {
      const res = await apiPost<ApiEnvelope<NotificationChannelRow>>(
        '/api/v1/alerts/channels',
        input,
      )
      return res.data
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: channelsKey }),
  })
}

export function useDeleteChannel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await apiDelete(`/api/v1/alerts/channels/${id}`)
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: channelsKey }),
  })
}

// ── Deliveries (audit log) ─────────────────────────────────────

export function useAlertDeliveries() {
  return useQuery({
    queryKey: deliveriesKey,
    queryFn: async () => {
      const res = await apiGet<ApiEnvelope<AlertDeliveryRow[]>>(
        '/api/v1/alerts/deliveries',
      )
      return res.data
    },
  })
}
