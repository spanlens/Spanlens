import 'server-only'
import { apiGetServer } from '@/lib/server/api'
import type { ApiEnvelope } from '@/lib/queries/types'
import type { AnnotationQueueItem, QueueFilters } from '@/lib/queries/use-human-evals'
import type { QuerySpec } from '@/lib/server/dehydrate'

export function annotationQueueSpec(filters: QueueFilters = {}): QuerySpec {
  return {
    queryKey: ['annotation', 'queue', filters] as const,
    queryFn: async () => {
      const qs = new URLSearchParams()
      if (filters.promptName) qs.set('promptName', filters.promptName)
      if (filters.promptVersionId) qs.set('promptVersionId', filters.promptVersionId)
      if (filters.unscoredOnly) qs.set('unscoredOnly', 'true')
      if (filters.lowJudgeScoreOnly) qs.set('lowJudgeScoreOnly', 'true')
      if (filters.limit) qs.set('limit', String(filters.limit))
      const suffix = qs.size > 0 ? `?${qs}` : ''
      const res = await apiGetServer<ApiEnvelope<AnnotationQueueItem[]>>(`/api/v1/annotation/queue${suffix}`)
      return res.data ?? []
    },
  }
}
