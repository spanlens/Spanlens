import 'server-only'
import { apiGetServer } from '@/lib/server/api'
import type { ApiEnvelope, WebhookRow } from '@/lib/queries/types'
import type { QuerySpec } from '@/lib/server/dehydrate'

// Must exactly match webhooksKey = ['webhooks'] in use-webhooks.ts
export function webhooksSpec(): QuerySpec {
  return {
    queryKey: ['webhooks'] as const,
    queryFn: async () => {
      const res = await apiGetServer<ApiEnvelope<WebhookRow[]>>('/api/v1/webhooks')
      return res.data
    },
  }
}
