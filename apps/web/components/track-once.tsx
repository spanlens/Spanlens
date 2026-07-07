'use client'
import { useEffect } from 'react'
// The restricted-imports rule guards against introducing cookie-setting
// analytics SDKs without the consent gate. Vercel Web Analytics is
// cookieless and its <Analytics /> component already runs from the root
// layout via the permitted '@vercel/analytics/next' subpath; that subpath
// does not re-export track(), so custom funnel events must come from the
// package root. No new cookie surface is added here.
// eslint-disable-next-line no-restricted-imports
import { track } from '@vercel/analytics'

interface TrackOnceProps {
  /** Vercel Analytics custom event name, e.g. "demo_entered". */
  event: string
  /**
   * Dedup scope: 'session' fires once per browser tab session,
   * 'local' once per browser (persists across sessions). Funnel events
   * that represent a one-time milestone (signup) use 'local'.
   */
  scope?: 'session' | 'local'
}

/**
 * Fires a Vercel Analytics custom event once on mount, guarded by
 * web storage so client-side re-navigation and revisits don't inflate
 * the count. Renders nothing.
 *
 * Storage can be unavailable (private mode, blocked cookies) — in that
 * case the event still fires and may double-count, which beats dropping
 * the funnel signal entirely.
 */
export function TrackOnce({ event, scope = 'session' }: TrackOnceProps) {
  useEffect(() => {
    const key = `sl_tracked_${event}`
    try {
      const store = scope === 'local' ? window.localStorage : window.sessionStorage
      if (store.getItem(key)) return
      store.setItem(key, '1')
    } catch {
      // fall through: track without dedup
    }
    // Child effects run before parent effects, so this can fire before the
    // root layout's <Analytics /> has installed window.va — track() would
    // then silently no-op. Install the same queue stub inject() uses; the
    // analytics script drains window.vaq once it loads.
    const w = window as typeof window & {
      va?: (...args: unknown[]) => void
      vaq?: unknown[][]
    }
    if (!w.va) {
      w.va = (...args: unknown[]) => {
        w.vaq = w.vaq ?? []
        w.vaq.push(args)
      }
    }
    track(event)
  }, [event, scope])
  return null
}
