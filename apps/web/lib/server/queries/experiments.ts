import 'server-only'
import { apiGetServer } from '@/lib/server/api'
import type { ApiEnvelope } from '@/lib/queries/types'
import type { Experiment } from '@/lib/queries/use-experiments'
import type { QuerySpec } from '@/lib/server/dehydrate'

export function experimentsSpec(promptName?: string): QuerySpec {
  return {
    queryKey: promptName ? (['experiments', promptName] as const) : (['experiments'] as const),
    queryFn: async () => {
      const qs = promptName ? `?promptName=${encodeURIComponent(promptName)}` : ''
      const res = await apiGetServer<ApiEnvelope<Experiment[]>>(`/api/v1/experiments${qs}`)
      return res.data ?? []
    },
  }
}
