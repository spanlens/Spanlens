import 'server-only'
import { apiGetServer } from '@/lib/server/api'
import type { QuerySpec } from '@/lib/server/dehydrate'
import type { ApiEnvelope } from '@/lib/queries/types'

// Must exactly match dismissalsKey = ['dismissals'] in use-dismissals.ts
export function dismissalsSpec(): QuerySpec {
  return {
    queryKey: ['dismissals'] as const,
    queryFn: async () => {
      const res = await apiGetServer<ApiEnvelope<string[]>>('/api/v1/dismissals')
      return res.data ?? []
    },
  }
}
