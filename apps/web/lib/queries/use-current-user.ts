'use client'

import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'

export interface CurrentUser {
  id: string
  email: string | null
  created_at: string
}

/**
 * Current authenticated user from the Supabase session. Client-only.
 */
export function useCurrentUser() {
  return useQuery({
    queryKey: ['current-user'] as const,
    queryFn: async (): Promise<CurrentUser | null> => {
      const supabase = createClient()
      const { data } = await supabase.auth.getUser()
      if (!data.user) return null
      return {
        id: data.user.id,
        email: data.user.email ?? null,
        created_at: data.user.created_at,
      }
    },
    staleTime: 5 * 60_000,
  })
}
