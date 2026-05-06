import 'server-only'
import { apiGetServer } from '@/lib/server/api'
import type { QuerySpec } from '@/lib/server/dehydrate'
import type { AlertDeliveryRow, AlertRow, ApiEnvelope, NotificationChannelRow } from '@/lib/queries/types'

// Must exactly match alertsKey / channelsKey / deliveriesKey in use-alerts.ts
const alertsQK = ['alerts'] as const
const channelsQK = ['alerts', 'channels'] as const
const deliveriesQK = ['alerts', 'deliveries'] as const

export function alertsSpec(): QuerySpec {
  return {
    queryKey: alertsQK,
    queryFn: async () => {
      const res = await apiGetServer<ApiEnvelope<AlertRow[]>>('/api/v1/alerts')
      return res.data
    },
  }
}

export function channelsSpec(): QuerySpec {
  return {
    queryKey: channelsQK,
    queryFn: async () => {
      const res = await apiGetServer<ApiEnvelope<NotificationChannelRow[]>>(
        '/api/v1/alerts/channels',
      )
      return res.data
    },
  }
}

export function deliveriesSpec(): QuerySpec {
  return {
    queryKey: deliveriesQK,
    queryFn: async () => {
      const res = await apiGetServer<ApiEnvelope<AlertDeliveryRow[]>>(
        '/api/v1/alerts/deliveries',
      )
      return res.data
    },
  }
}
