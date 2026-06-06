/**
 * Shared classifier + formatter for `api_keys.last_used_at`.
 *
 * Authentication middleware throttle-writes this column on every proxy
 * hit (see apps/server/src/lib/api-key-last-used.ts). The dashboard reads
 * the column to surface keys that look abandoned so the user can revoke
 * them without combing through audit logs.
 *
 * Buckets (intentionally loose — auditors don't agree on a number either):
 *   fresh              — used within the past 30 days
 *   stale              — 30–89 days idle. Soft hint; still active.
 *   consider_revoking  — 90+ days idle, OR never used since creation 90+
 *                        days ago. Hard hint; show in accent colour.
 *   unknown            — null last_used_at + key younger than 30 days.
 *                        Nothing to act on yet; render neutrally.
 *
 * We treat `created_at` as the floor when `last_used_at` is null. A brand-
 * new key with zero traffic is "unknown", not "stale" — labelling it
 * Stale on day one would be misleading. After 30 days of no traffic we
 * promote to Stale; after 90 days, to Consider revoking.
 */

export type StalenessBucket = 'fresh' | 'stale' | 'consider_revoking' | 'unknown'

const DAY_MS = 24 * 60 * 60 * 1000
export const STALE_DAYS = 30
export const REVOKE_DAYS = 90

export interface StalenessInput {
  /** ISO timestamp from `api_keys.last_used_at`, or null when the key has never authenticated. */
  lastUsedAt: string | null
  /** ISO timestamp from `api_keys.created_at`. */
  createdAt: string
  /** Override "now" for deterministic tests. Defaults to `Date.now()` at call site. */
  now?: number
}

export interface StalenessResult {
  bucket: StalenessBucket
  /** Whole days since last use (or since creation, if never used). */
  daysIdle: number
}

export function classifyStaleness({
  lastUsedAt,
  createdAt,
  now = Date.now(),
}: StalenessInput): StalenessResult {
  const referenceMs = lastUsedAt
    ? Date.parse(lastUsedAt)
    : Date.parse(createdAt)

  if (!Number.isFinite(referenceMs)) {
    // Defensive — bad input shouldn't crash the dashboard.
    return { bucket: 'unknown', daysIdle: 0 }
  }

  const daysIdle = Math.max(0, Math.floor((now - referenceMs) / DAY_MS))

  if (daysIdle >= REVOKE_DAYS) return { bucket: 'consider_revoking', daysIdle }
  if (daysIdle >= STALE_DAYS) return { bucket: 'stale', daysIdle }
  if (lastUsedAt === null) return { bucket: 'unknown', daysIdle }
  return { bucket: 'fresh', daysIdle }
}

/**
 * Human-readable "last used Xd ago" / "never used" string. Returns null for
 * 'unknown' inside the first 30 days so the caller can show its own
 * placeholder when SSR / hydration matters.
 */
export function formatLastUsed(input: StalenessInput): string {
  const { bucket, daysIdle } = classifyStaleness(input)

  if (bucket === 'unknown') return 'never used'

  if (daysIdle === 0) return 'last used today'
  if (daysIdle === 1) return 'last used yesterday'
  return `last used ${daysIdle}d ago`
}
