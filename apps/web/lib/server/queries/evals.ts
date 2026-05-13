import 'server-only'
import { apiGetServer } from '@/lib/server/api'
import type { ApiEnvelope } from '@/lib/queries/types'
import type { Evaluator, EvalRun } from '@/lib/queries/use-evals'
import type { QuerySpec } from '@/lib/server/dehydrate'

// Must match ['evaluators'] in use-evals.ts evaluatorsQueryKey()
export function evaluatorsSpec(promptName?: string): QuerySpec {
  return {
    queryKey: promptName ? (['evaluators', promptName] as const) : (['evaluators'] as const),
    queryFn: async () => {
      const qs = promptName ? `?promptName=${encodeURIComponent(promptName)}` : ''
      const res = await apiGetServer<ApiEnvelope<Evaluator[]>>(`/api/v1/evaluators${qs}`)
      return res.data ?? []
    },
  }
}

// Must match ['eval-runs'] / ['eval-runs', filters] in use-evals.ts
export function evalRunsSpec(filters?: { evaluatorId?: string; promptVersionId?: string }): QuerySpec {
  return {
    queryKey: filters ? (['eval-runs', filters] as const) : (['eval-runs'] as const),
    queryFn: async () => {
      const qs = new URLSearchParams()
      if (filters?.evaluatorId) qs.set('evaluatorId', filters.evaluatorId)
      if (filters?.promptVersionId) qs.set('promptVersionId', filters.promptVersionId)
      const suffix = qs.size > 0 ? `?${qs}` : ''
      const res = await apiGetServer<ApiEnvelope<EvalRun[]>>(`/api/v1/eval-runs${suffix}`)
      return res.data ?? []
    },
  }
}
