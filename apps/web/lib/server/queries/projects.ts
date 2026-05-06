import 'server-only'
import { apiGetServer } from '@/lib/server/api'
import type { ApiEnvelope, Project, ApiKey, ProviderKey } from '@/lib/queries/types'
import type { QuerySpec } from '@/lib/server/dehydrate'

// Must exactly match projectsQueryKey in use-projects.ts
const projectsQK = ['projects'] as const

// Must exactly match apiKeysQueryKey in use-api-keys.ts
const apiKeysQK = ['api-keys'] as const

// Must exactly match providerKeysQueryKey in use-provider-keys.ts
const providerKeysQK = ['provider-keys'] as const

export function projectsSpec(): QuerySpec {
  return {
    queryKey: projectsQK,
    queryFn: async () => {
      const res = await apiGetServer<ApiEnvelope<Project[]>>('/api/v1/projects')
      return res.data
    },
  }
}

export function apiKeysSpec(): QuerySpec {
  return {
    queryKey: apiKeysQK,
    queryFn: async () => {
      const res = await apiGetServer<ApiEnvelope<ApiKey[]>>('/api/v1/api-keys')
      return res.data
    },
  }
}

export function providerKeysSpec(): QuerySpec {
  return {
    queryKey: providerKeysQK,
    queryFn: async () => {
      const res = await apiGetServer<ApiEnvelope<ProviderKey[]>>('/api/v1/provider-keys')
      return res.data
    },
  }
}
