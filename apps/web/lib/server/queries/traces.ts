import 'server-only'
import { apiGetServer } from '@/lib/server/api'
import type { TraceDetail, ApiEnvelope } from '@/lib/queries/types'
import type { QuerySpec } from '@/lib/server/dehydrate'

// Must exactly match traceQueryKey() in use-traces.ts
function traceQK(id: string) {
  return ['trace', id] as const
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
