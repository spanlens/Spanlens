import { supabaseAdmin } from './db.js'
import type { Plan } from './quota.js'

/**
 * Per-minute proxy ingestion limits keyed by plan.
 *
 * Applied per organization (all API keys in the same org share the bucket).
 * Enterprise is unlimited (null).
 */
export const PROXY_RATE_LIMITS: Record<Plan, number | null> = {
  free:       60,
  starter:    300,
  team:       1_500,
  enterprise: null,
}

/**
 * Unified per-minute limit for all dashboard API routes (/api/v1/*).
 *
 * Same for every plan — dashboard usage is human-paced so this only
 * ever triggers against scrapers or runaway automation.
 */
export const API_RATE_LIMIT = 120

/** Returns the current UTC minute window string: "YYYY-MM-DDTHH:MM" */
function currentWindow(): string {
  return new Date().toISOString().slice(0, 16)
}

/**
 * Atomically increments the request count for (key, currentMinute) and
 * returns whether the request is within the given limit.
 *
 * Fails open (returns true) on any DB error so transient Supabase
 * hiccups never block legitimate traffic.
 */
export async function checkRateLimit(
  key: string,
  limit: number,
): Promise<boolean> {
  const window = currentWindow()

  const { data, error } = await supabaseAdmin.rpc('check_rate_limit', {
    p_key: key,
    p_window_key: window,
    p_limit: limit,
  })

  if (error) {
    console.error('[rate-limit] rpc error — failing open:', error.message)
    return true
  }

  return data as boolean
}
