import 'server-only'
import { apiGetServer } from '@/lib/server/api'
import type { ApiEnvelope } from '@/lib/queries/types'
import type { Dataset } from '@/lib/queries/use-datasets'
import type { QuerySpec } from '@/lib/server/dehydrate'

// Must match ['datasets'] in use-datasets.ts
export function datasetsSpec(): QuerySpec {
  return {
    queryKey: ['datasets'] as const,
    queryFn: async () => {
      const res = await apiGetServer<ApiEnvelope<Dataset[]>>('/api/v1/datasets')
      return res.data ?? []
    },
  }
}
