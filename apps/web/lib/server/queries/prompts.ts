import 'server-only'
import { apiGetServer } from '@/lib/server/api'
import type { ApiEnvelope } from '@/lib/queries/types'
import type { PromptVersion, PromptExperiment } from '@/lib/queries/use-prompts'
import type { QuerySpec } from '@/lib/server/dehydrate'

// Must exactly match ['prompts', { projectId: undefined, sinceHours: 24 }] in use-prompts.ts
// Prefetches the default 24-hour window for the prompts list
export function promptsListSpec(): QuerySpec {
  return {
    queryKey: ['prompts', { projectId: undefined, sinceHours: 24 }] as const,
    queryFn: async () => {
      const res = await apiGetServer<ApiEnvelope<PromptVersion[]>>('/api/v1/prompts')
      return res.data ?? []
    },
  }
}

// Must exactly match ['prompts', 'versions', name] in use-prompts.ts
export function promptVersionsSpec(name: string): QuerySpec {
  return {
    queryKey: ['prompts', 'versions', name] as const,
    queryFn: async () => {
      const res = await apiGetServer<ApiEnvelope<PromptVersion[]>>(
        `/api/v1/prompts/${encodeURIComponent(name)}`,
      )
      return res.data ?? []
    },
  }
}

// Must exactly match ['prompt-experiments', { promptName: name, status: undefined }] in use-prompts.ts
export function promptExperimentsSpec(name: string): QuerySpec {
  return {
    queryKey: ['prompt-experiments', { promptName: name, status: undefined }] as const,
    queryFn: async () => {
      const res = await apiGetServer<ApiEnvelope<PromptExperiment[]>>(
        `/api/v1/prompt-experiments?promptName=${encodeURIComponent(name)}`,
      )
      return res.data ?? []
    },
  }
}
