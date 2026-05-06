import 'server-only'
import { apiGetServer } from '@/lib/server/api'
import type { RequestDetail, RequestRow, RequestsPage, ApiEnvelope } from '@/lib/queries/types'
import type { QuerySpec } from '@/lib/server/dehydrate'

// Must exactly match requestQueryKey() in use-requests.ts
function requestQK(id: string) {
  return ['request', id] as const
}

// Must exactly match requestsQueryKey({ page: 1, limit: 50 }) in use-requests.ts
// Prefetches the default (no-filter) first page for the requests list
export function requestsListSpec(): QuerySpec {
  return {
    queryKey: ['requests', { page: 1, limit: 50 }] as const,
    queryFn: async () => {
      const res = await apiGetServer<ApiEnvelope<RequestRow[]>>(
        '/api/v1/requests?page=1&limit=50',
      )
      const result: RequestsPage = {
        data: res.data ?? [],
        meta: res.meta ?? { total: res.data?.length ?? 0, page: 1, limit: 50 },
      }
      return result
    },
    staleTime: 30_000,
  }
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
