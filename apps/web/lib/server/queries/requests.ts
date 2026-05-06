import 'server-only'
import { apiGetServer } from '@/lib/server/api'
import type { RequestDetail, ApiEnvelope } from '@/lib/queries/types'
import type { QuerySpec } from '@/lib/server/dehydrate'

// Must exactly match requestQueryKey() in use-requests.ts
function requestQK(id: string) {
  return ['request', id] as const
}

export function requestSpec(id: string): QuerySpec {
  return {
    queryKey: requestQK(id),
    queryFn: async () => {
      const res = await apiGetServer<ApiEnvelope<RequestDetail>>(`/api/v1/requests/${id}`)
      return res.data
    },
    staleTime: 5 * 60_000,
  }
}
