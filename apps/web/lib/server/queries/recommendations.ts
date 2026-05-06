import 'server-only'
import { apiGetServer } from '@/lib/server/api'
import type { ModelRecommendation, RecommendationsParams } from '@/lib/queries/use-recommendations'
import type { QuerySpec } from '@/lib/server/dehydrate'
import type { ApiEnvelope } from '@/lib/queries/types'

// Must exactly match recommendationsQueryKey() in use-recommendations.ts
function recommendationsQK(params: RecommendationsParams) {
  return ['recommendations', params] as const
}

// Must exactly match buildRecommendationsPath() in use-recommendations.ts
function buildPath(params: RecommendationsParams): string {
  const qs = new URLSearchParams()
  if (params.hours) qs.set('hours', String(params.hours))
  if (params.minSavings) qs.set('minSavings', String(params.minSavings))
  const suffix = qs.size > 0 ? `?${qs}` : ''
  return `/api/v1/recommendations${suffix}`
}

export function recommendationsSpec(params: RecommendationsParams = {}): QuerySpec {
  return {
    queryKey: recommendationsQK(params),
    queryFn: async () => {
      const res = await apiGetServer<ApiEnvelope<ModelRecommendation[]>>(buildPath(params))
      return res.data ?? []
    },
    staleTime: 10 * 60_000,
  }
}
