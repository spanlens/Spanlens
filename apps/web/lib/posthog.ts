/**
 * PostHog analytics — typed capture helper.
 *
 * Import `capture` from here instead of calling posthog directly so that:
 *  1. All event names + property shapes are centrally documented.
 *  2. TypeScript enforces the correct property bag for each event.
 *  3. SSR never crashes (guarded by `typeof window` check).
 *  4. Consent is enforced at the choke point — `capture()` no-ops unless
 *     the user has opted into analytics cookies (lib/cookie-consent.ts).
 *
 * The SDK itself is initialized in
 * `components/providers/posthog-provider.tsx`, which is the only file
 * allowed to import `posthog-js` (see the no-restricted-imports rule in
 * eslint.config.mjs). This module deliberately reaches for
 * `window.posthog` instead of importing the SDK so the restriction stays
 * meaningful.
 */

import { isAnalyticsAllowed } from '@/lib/cookie-consent'

export const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY ?? ''
export const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com'

// ── Typed event catalog ───────────────────────────────────────────────────────
// Payloads for the users/cache events were designed in
// docs/launch/2026-05-14_cache-stream-users.md §3.

export type AnalyticsEvent =
  // Evals
  | { event: 'evaluator_created';     properties: { judge_provider: string; prompt_name?: string } }
  | { event: 'eval_run_triggered';    properties: { source: 'production' | 'dataset'; evaluator_id: string } }
  // Datasets
  | { event: 'dataset_created';       properties: { record: true } }
  | { event: 'dataset_item_added';    properties: { dataset_id: string } }
  // Experiments
  | { event: 'experiment_created';    properties: { run_model: string; has_dataset: boolean } }
  // Annotation
  | { event: 'human_eval_saved';      properties: { raw_score: number; has_comment: boolean; is_update: boolean } }
  | { event: 'annotation_tab_viewed'; properties: { tab: 'queue' | 'agreement' } }
  // Requests
  | { event: 'request_filter_applied'; properties: { filter_type: 'user_id' | 'session_id' } }
  | { event: 'cache_breakdown_viewed'; properties: { provider: string; model: string; cache_hit_rate: number; cost_usd: number } }
  // Users analytics
  | { event: 'users_page_viewed';     properties: { sort_by: string; sort_dir: 'asc' | 'desc'; has_search: boolean; page: number } }
  | { event: 'users_row_clicked';     properties: { user_id_hashed: string } }
  | { event: 'user_detail_viewed';    properties: { user_id_hashed: string } }
  // Prompts
  | { event: 'prompt_version_created'; properties: { prompt_name: string } }
  | { event: 'prompt_ab_test_started'; properties: { prompt_name: string } }

// ── capture() ────────────────────────────────────────────────────────────────

/**
 * Fire a typed analytics event.
 * Safe to call server-side (no-op), before PostHog initialises (no-op),
 * and without consent (no-op — consent is also enforced upstream by the
 * provider, which never initialises the SDK without opt-in).
 */
export function capture(evt: AnalyticsEvent): void {
  if (typeof window === 'undefined') return
  if (!isAnalyticsAllowed()) return
  try {
    // posthog-js attaches itself to window.posthog after init
    const ph = (window as unknown as Record<string, unknown>).posthog as
      | { capture: (event: string, props?: Record<string, unknown>) => void }
      | undefined
    ph?.capture(evt.event, evt.properties)
  } catch {
    // Never let analytics crash the app
  }
}

/**
 * End-user IDs (`x-spanlens-user` values) are customer data — hash before
 * sending to PostHog so the analytics store never holds raw IDs.
 * djb2 — tiny, stable, non-cryptographic; collision risk is acceptable
 * for funnel analytics.
 */
export function hashUserId(raw: string): string {
  let h = 5381
  for (let i = 0; i < raw.length; i++) h = ((h << 5) + h + raw.charCodeAt(i)) | 0
  return `u_${(h >>> 0).toString(36)}`
}
