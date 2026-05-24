'use client'

import { useQuery } from '@tanstack/react-query'

import { apiGet } from '@/lib/api'
import type { ApiEnvelope } from './types'

/**
 * Catalog of priced models, grouped by provider. Backs the Playground tab
 * selector so the picker auto-tracks whatever's in model_prices instead of
 * the old hardcoded 12-entry list.
 *
 * Dated snapshots (e.g. gpt-4o-2024-05-13) are hidden by the API when an
 * alias of the same family exists. Callers can still hit dated models
 * directly via the API — just not via the picker UI.
 */

export interface ModelEntry {
  model: string
  promptPricePer1m: number
  completionPricePer1m: number
  cacheReadPricePer1m: number | null
  cacheWritePricePer1m: number | null
  longContextThresholdTokens: number | null
}

export interface ModelsByProvider {
  openai: ModelEntry[]
  anthropic: ModelEntry[]
  gemini: ModelEntry[]
}

const EMPTY: ModelsByProvider = { openai: [], anthropic: [], gemini: [] }

export function useModels() {
  return useQuery({
    queryKey: ['models'] as const,
    queryFn: async () => {
      const res = await apiGet<ApiEnvelope<ModelsByProvider>>('/api/v1/models')
      return res.data ?? EMPTY
    },
    // Model catalog changes when an admin updates model_prices. That's
    // rare (quarterly at most) so cache for a long time — switching tabs
    // shouldn't re-fetch.
    staleTime: 30 * 60_000,
  })
}
