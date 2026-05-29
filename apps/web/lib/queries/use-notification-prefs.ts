'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPatch } from '@/lib/api'
import type { ApiEnvelope, UserNotificationPrefs } from './types'

export const notificationPrefsKey = ['me', 'notification-prefs'] as const

/** GET /api/v1/me/notification-prefs — current user's email preferences. */
export function useNotificationPrefs() {
  return useQuery({
    queryKey: notificationPrefsKey,
    queryFn: async () => {
      const res = await apiGet<ApiEnvelope<UserNotificationPrefs>>(
        '/api/v1/me/notification-prefs',
      )
      return res.data
    },
  })
}

/** PATCH /api/v1/me/notification-prefs — update one or more toggles. */
export function useUpdateNotificationPrefs() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (update: Partial<UserNotificationPrefs>) => {
      const res = await apiPatch<ApiEnvelope<UserNotificationPrefs>>(
        '/api/v1/me/notification-prefs',
        update,
      )
      return res.data
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: notificationPrefsKey })
    },
  })
}
