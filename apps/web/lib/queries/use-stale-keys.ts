'use client'

import { useMemo, useState } from 'react'
import { classifyStaleness } from '@/lib/api-key-staleness'
import { useApiKeys } from './use-api-keys'

/**
 * Aggregate `api_keys` staleness across all visible keys (full + public).
 *
 * Drives two surfaces:
 *   • Sidebar "Projects & Keys" badge — warn-coloured count of keys at
 *     the "consider revoking" tier.
 *   • Dashboard "Needs Attention" card — same data, plus the stale-tier
 *     count and a sample key name so the prompt is more concrete than a
 *     bare integer.
 *
 * Re-uses the existing `useApiKeys()` cache entry — TanStack Query dedupes
 * the network request against whatever the /projects page already requested.
 * Counting is cheap pure JS in a useMemo so the hook is safe to call from
 * anywhere.
 *
 * `useApiKeys()` alone is the COMPLETE set. Do NOT add `usePublicKeys()` back
 * in: `GET /api/v1/api-keys` with no `scope` filter already returns
 * workspace-level public keys alongside project keys — the handler unions the
 * two ownership columns with `.or(project_id.in(...), organization_id.eq...)`
 * (apps/server/src/api/apiKeys.ts). Spreading `usePublicKeys()` on top counted
 * every public key twice, inflating both the sidebar badge and the dashboard
 * "N keys idle" card for any workspace that had issued one.
 *
 * Deactivated keys (is_active=false) are intentionally excluded: once a
 * key has been revoked it can't be re-used, so flagging it as "stale" is
 * noise rather than signal.
 */

export interface StaleKeyCounts {
  /** 30-89 days idle since last_used_at (or created_at when never used). */
  stale: number
  /** 90+ days idle. The actionable tier. */
  revoke: number
  /** Total active keys considered (denominator for "M of N idle"). */
  totalActive: number
  /** Name of the worst-tier candidate for use in copy. Undefined when
   *  nothing is flagged. revoke-tier wins over stale-tier. */
  sampleName?: string
  isLoading: boolean
}

export function useStaleKeyCounts(): StaleKeyCounts {
  const apiKeys = useApiKeys()
  // Capture "now" once at mount. Staleness boundaries are 30 / 90 days,
  // so the user crossing a tier on a long-lived dashboard tab without a
  // refresh is well within the noise floor. Reading Date.now() inside
  // useMemo trips React Compiler's purity rule (call-of-impure-fn).
  const [mountNow] = useState(() => Date.now())

  return useMemo(() => {
    const active = (apiKeys.data ?? []).filter((k) => k.is_active)
    const now = mountNow

    let stale = 0
    let revoke = 0
    let revokeSample: string | undefined
    let staleSample: string | undefined

    for (const k of active) {
      const { bucket } = classifyStaleness({
        lastUsedAt: k.last_used_at,
        createdAt: k.created_at,
        now,
      })
      if (bucket === 'consider_revoking') {
        revoke += 1
        if (!revokeSample) revokeSample = k.name
      } else if (bucket === 'stale') {
        stale += 1
        if (!staleSample) staleSample = k.name
      }
    }

    // exactOptionalPropertyTypes — only attach sampleName when we have one;
    // assigning `undefined` to an optional field is a type error in this repo.
    const sample = revokeSample ?? staleSample
    const result: StaleKeyCounts = {
      stale,
      revoke,
      totalActive: active.length,
      isLoading: apiKeys.isLoading,
    }
    if (sample) result.sampleName = sample
    return result
  }, [apiKeys.data, apiKeys.isLoading, mountNow])
}
