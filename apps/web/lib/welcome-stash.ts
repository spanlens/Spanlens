/**
 * Single-source-of-truth helper for the post-signup welcome banner's API
 * key handoff between `/onboarding` and `/dashboard`.
 *
 * The freshly-issued `sl_live_*` key is shown exactly once on the welcome
 * banner because the server only stores its SHA-256 hash. We stash it in
 * sessionStorage during onboarding and consume it on the dashboard.
 *
 * Why three layers of protection (and why a helper, not three call sites):
 *
 *   1. **One-shot consume** — `consume()` removes the entry immediately
 *      after a successful read. Navigating away then back, or refreshing
 *      `/dashboard`, will not re-display the key. Matches the
 *      "won't be shown again" copy.
 *
 *   2. **User-bound payload** — the stash stores `{ apiKey, userId }`.
 *      `consume(currentUserId)` returns `null` (and clears the entry)
 *      when the cached `userId` does not match the signed-in user. This
 *      closes the cross-account leak where user A signs up, walks away
 *      without dismissing, user B signs in on the same browser tab, and
 *      `/dashboard` would have happily shown them A's key.
 *
 *   3. **Explicit clear on logout** — `clear()` is also called from
 *      `handleSignOut`, so even an edge case where the welcome banner
 *      never mounted (e.g. A signed up, navigated straight to
 *      `/projects`, then logged out) does not leave a residue for the
 *      next person to sign in on the same tab.
 *
 * Anything not in JSON shape, or missing either field, is treated as
 * stale and removed. That covers the upgrade case from the old raw-string
 * format and any future schema drift.
 */

const STORAGE_KEY = 'spanlens:welcome_api_key'

interface WelcomeStash {
  apiKey: string
  userId: string
}

function isWelcomeStash(value: unknown): value is WelcomeStash {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { apiKey?: unknown }).apiKey === 'string' &&
    typeof (value as { userId?: unknown }).userId === 'string'
  )
}

/** Best-effort write. Silent failure (private mode, blocked storage). */
export function writeWelcomeStash(apiKey: string, userId: string): void {
  if (typeof window === 'undefined') return
  try {
    const payload: WelcomeStash = { apiKey, userId }
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // ignore — banner just won't appear; the user can issue a new key
    // from /projects if they need one.
  }
}

/**
 * Read + remove the stash if it belongs to `currentUserId`. Returns the
 * raw API key on success; `null` otherwise (no entry, parse failure,
 * mismatched user — and the stale entry is removed in all those cases).
 *
 * Callers should treat the returned key as ephemeral: it is held only in
 * React state for the lifetime of the banner mount.
 */
export function consumeWelcomeStash(currentUserId: string): string | null {
  if (typeof window === 'undefined') return null
  let raw: string | null
  try {
    raw = sessionStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
  if (!raw) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // Old raw-string format or corrupted entry — discard.
    safeRemove()
    return null
  }

  if (!isWelcomeStash(parsed)) {
    safeRemove()
    return null
  }

  // Cross-account guard: a stash from a previous session must never be
  // surfaced to a different signed-in user.
  if (parsed.userId !== currentUserId) {
    safeRemove()
    return null
  }

  // One-shot consume: remove BEFORE returning so a quick remount or a
  // second `/dashboard` visit in the same tab does not re-display.
  safeRemove()
  return parsed.apiKey
}

/** Unconditional remove. Used by sign-out and as a defensive clear. */
export function clearWelcomeStash(): void {
  if (typeof window === 'undefined') return
  safeRemove()
}

function safeRemove(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}
