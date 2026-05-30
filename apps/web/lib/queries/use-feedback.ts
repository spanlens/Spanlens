'use client'

import { useMutation } from '@tanstack/react-query'
import { apiPost } from '@/lib/api'

export type FeedbackCategory = 'feature' | 'bug' | 'other'

export interface SubmitFeedbackInput {
  message: string
  category: FeedbackCategory
  source?: string
}

export function useSubmitFeedback() {
  return useMutation({
    mutationFn: (input: SubmitFeedbackInput) =>
      apiPost<{ success: boolean }>('/api/v1/feedback', {
        message: input.message,
        category: input.category,
        source: input.source ?? 'dashboard',
      }),
  })
}
