/**
 * Cookie consent infrastructure — gating mechanism for any future
 * non-essential cookies (analytics, A/B testing, advertising).
 *
 * Current Spanlens state: NO non-essential cookies are loaded. The only
 * cookies set by the app are session tokens managed by Supabase Auth
 * (`sb-access-token`, `sb-refresh-token`), which fall under ePrivacy
 * Directive's "strictly necessary" exception and do not require consent.
 *
 * This module exists so that when analytics or other optional cookies
 * are added in the future, the integration code can gate on
 * `isAnalyticsAllowed()` and the cookie consent banner can be enabled
 * by mounting `<CookieConsentBanner />` in `app/layout.tsx`. The
 * regression test in `__tests__/no-analytics-scripts.test.ts` ensures
 * that no analytics scripts are added without first wiring this gate.
 */

const CONSENT_KEY = 'spanlens.cookie-consent.v1'

export type ConsentCategory = 'analytics' | 'marketing'

export interface ConsentState {
  /** Did the user actively engage with the banner? */
  decided: boolean
  /** Each non-essential category opt-in (default: false). */
  granted: Record<ConsentCategory, boolean>
  /** ISO timestamp of the most recent decision. */
  decidedAt: string | null
}

const DEFAULT_STATE: ConsentState = {
  decided: false,
  granted: { analytics: false, marketing: false },
  decidedAt: null,
}

/**
 * Read the current consent state from localStorage. Returns the default
 * (all categories denied, undecided) when storage is empty, unavailable,
 * or contains malformed data.
 *
 * SSR-safe — returns the default state on the server.
 */
export function readConsent(): ConsentState {
  if (typeof window === 'undefined') return DEFAULT_STATE
  try {
    const raw = window.localStorage.getItem(CONSENT_KEY)
    if (!raw) return DEFAULT_STATE
    const parsed = JSON.parse(raw) as Partial<ConsentState>
    return {
      decided: Boolean(parsed.decided),
      granted: {
        analytics: Boolean(parsed.granted?.analytics),
        marketing: Boolean(parsed.granted?.marketing),
      },
      decidedAt: typeof parsed.decidedAt === 'string' ? parsed.decidedAt : null,
    }
  } catch {
    return DEFAULT_STATE
  }
}

/**
 * Persist a fresh decision. Always sets `decided: true` and stamps the
 * current ISO timestamp. Use `denyAll()` / `acceptAll()` helpers for the
 * common cases rather than calling this directly with raw flags.
 */
export function writeConsent(granted: Record<ConsentCategory, boolean>): ConsentState {
  const state: ConsentState = {
    decided: true,
    granted,
    decidedAt: new Date().toISOString(),
  }
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(CONSENT_KEY, JSON.stringify(state))
    } catch {
      // localStorage disabled — the in-memory state below is the best we can do
    }
  }
  return state
}

export function acceptAll(): ConsentState {
  return writeConsent({ analytics: true, marketing: true })
}

export function denyAll(): ConsentState {
  return writeConsent({ analytics: false, marketing: false })
}

/**
 * Gate for analytics SDK initialization. Any future GA / PostHog /
 * Plausible / Mixpanel integration MUST check this before sending data.
 *
 * Example:
 *   if (isAnalyticsAllowed()) initPostHog(...)
 */
export function isAnalyticsAllowed(): boolean {
  return readConsent().granted.analytics
}

export function isMarketingAllowed(): boolean {
  return readConsent().granted.marketing
}

/**
 * Whether the consent banner should be visible to the user. Currently
 * returns `false` unconditionally because Spanlens does not use any
 * non-essential cookies — showing a banner for cookies that don't exist
 * would be misleading. Flip this to `!readConsent().decided` (or some
 * environment-flag-gated equivalent) at the same time you wire up the
 * first analytics integration.
 */
export function shouldShowBanner(): boolean {
  return false
}
