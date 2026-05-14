/**
 * PostHog analytics — typed capture helper.
 *
 * Import `capture` from here instead of calling posthog directly so that:
 *  1. All event names + property shapes are centrally documented.
 *  2. TypeScript enforces the correct property bag for each event.
 *  3. SSR never crashes (guarded by `typeof window` check).
 */

export const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY ?? ''
export const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com'

// ── Typed event catalog ───────────────────────────────────────────────────────

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
  // Prompts
  | { event: 'prompt_version_created'; properties: { prompt_name: string } }
  | { event: 'prompt_ab_test_started'; properties: { prompt_name: string } }

// ── capture() ────────────────────────────────────────────────────────────────

/**
 * Fire a typed analytics event.
 * Safe to call server-side (no-op) or when PostHog hasn't initialised yet.
 */
export function capture(evt: AnalyticsEvent): void {
  if (typeof window === 'undefined') return
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
