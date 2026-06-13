'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import type { ApiEnvelope } from './types'

/**
 * Global catalogue of pre-baked LLM-as-judge templates. Drives the empty
 * state quick-start cards on /evals — replaces a hard-coded constant that
 * used to ship with the dashboard bundle.
 *
 * The catalogue rarely changes (additions ship via SQL migration) so the
 * query holds onto results for 10 minutes. The categories are stable
 * enough that we expose a grouped helper alongside the flat list.
 */

export type EvaluatorTemplateCategory = 'quality' | 'safety' | 'cost'

export interface EvaluatorTemplate {
  id: string
  slug: string
  name: string
  description: string
  category: EvaluatorTemplateCategory
  criterion: string
  recommended_judge_provider: 'openai' | 'anthropic' | 'gemini' | 'azure' | 'mistral' | 'openrouter'
  recommended_judge_model: string
  display_order: number
}

export const evaluatorTemplatesKey = ['evaluator-templates'] as const

export function useEvaluatorTemplates() {
  return useQuery({
    queryKey: evaluatorTemplatesKey,
    queryFn: async () => {
      const res = await apiGet<ApiEnvelope<EvaluatorTemplate[]>>(
        '/api/v1/evaluator-templates',
      )
      return res.data ?? []
    },
    staleTime: 10 * 60_000,
  })
}

/**
 * Same data, pre-bucketed by category. Useful when the UI shows tabs and
 * needs to know the per-tab count without re-filtering on every render.
 */
export function useEvaluatorTemplatesByCategory(): {
  quality: EvaluatorTemplate[]
  safety: EvaluatorTemplate[]
  cost: EvaluatorTemplate[]
  isLoading: boolean
} {
  const query = useEvaluatorTemplates()
  return useMemo(() => {
    const groups: Record<EvaluatorTemplateCategory, EvaluatorTemplate[]> = {
      quality: [],
      safety: [],
      cost: [],
    }
    for (const t of query.data ?? []) {
      // The server orders by category + display_order, so push preserves order.
      groups[t.category].push(t)
    }
    return { ...groups, isLoading: query.isLoading }
  }, [query.data, query.isLoading])
}
