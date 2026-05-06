import 'server-only'
import { apiGetServer } from '@/lib/server/api'
import type { TraceDetail, TraceRow, TracesPage, ApiEnvelope } from '@/lib/queries/types'
import type { QuerySpec } from '@/lib/server/dehydrate'

// Must exactly match traceQueryKey() in use-traces.ts
function traceQK(id: string) {
  return ['trace', id] as const
}

// Must exactly match tracesQueryKey({ page: 1, limit: 50, status: 'all' }) in use-traces.ts
// Note: 'all' status is not sent to the API (matches client-side hook logic)
export function tracesListSpec(): QuerySpec {
  return {
    queryKey: ['traces', { page: 1, limit: 50, status: 'all' }] as const,
    queryFn: async () => {
      const res = await apiGetServer<ApiEnvelope<TraceRow[]>>(
        '/api/v1/traces?page=1&limit=50',
      )
      const result: TracesPage = {
        data: res.data ?? [],
        meta: res.meta ?? { total: res.data?.length ?? 0, page: 1, limit: 50 },
      }
      return result
    },
    staleTime: 10_000,
  }
}

export function traceDetailSpec(id: string): QuerySpec {
  return {
    queryKey: traceQK(id),
    queryFn: async () => {
      const res = await apiGetServer<ApiEnvelope<TraceDetail>>(`/api/v1/traces/${id}`)
      return res.data
    },
    // running traces refetch every 3 s on the client; keep server data fresh for 3 s too
    staleTime: 3_000,
  }
}
