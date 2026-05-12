'use client'
import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'

export type RealtimeStatus = 'connecting' | 'connected' | 'disconnected'

export interface RealtimeRequestsResult {
  status: RealtimeStatus
  lastEventAt: Date | null
}

/**
 * Subscribes to Supabase Realtime for requests table INSERT events.
 * On each new request, invalidates stats/anomalies queries so the dashboard
 * immediately reflects the change without waiting for the polling interval.
 *
 * Requires the requests table to be in the supabase_realtime publication
 * and have REPLICA IDENTITY FULL (see migration 20260512120000).
 */
export function useRealtimeRequests(): RealtimeRequestsResult {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<RealtimeStatus>('connecting')
  const [lastEventAt, setLastEventAt] = useState<Date | null>(null)
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const supabase = createClient()

    const channel = supabase
      .channel('db:requests')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'requests' },
        () => {
          setLastEventAt(new Date())
          // Debounce bursts: wait 800 ms after the last INSERT before refetching
          // so a flurry of parallel LLM calls triggers one refetch, not N.
          if (debounceTimer.current) clearTimeout(debounceTimer.current)
          debounceTimer.current = setTimeout(() => {
            void queryClient.invalidateQueries({ queryKey: ['stats'] })
            void queryClient.invalidateQueries({ queryKey: ['anomalies'] })
          }, 800)
        },
      )
      .subscribe((s) => {
        if (s === 'SUBSCRIBED') setStatus('connected')
        else if (s === 'CLOSED' || s === 'CHANNEL_ERROR') setStatus('disconnected')
        else setStatus('connecting')
      })

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
      void supabase.removeChannel(channel)
    }
  }, [queryClient])

  return { status, lastEventAt }
}
