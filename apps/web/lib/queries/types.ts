/**
 * Shared DTOs for the REST API. Keep in sync with the shapes returned by
 * apps/server/src/api/*.
 *
 * The server wraps successful responses in `{ success: true, data, meta? }`.
 * Query hooks unwrap `data` before returning to callers, so components
 * work with these types directly.
 */

export interface ApiEnvelope<T> {
  success: boolean
  data: T
  meta?: { total: number; page: number; limit: number }
  error?: string
}

export interface Organization {
  id: string
  name: string
  plan: string
  /** Pattern C: whether to allow overage billing past soft limit. Free plan ignores this. */
  allow_overage: boolean
  /** Hard cap = monthly_limit * overage_cap_multiplier. 1–100. */
  overage_cap_multiplier: number
  /** Notification-only: weekly digest of provider keys unused for `stale_key_threshold_days`. */
  stale_key_alerts_enabled: boolean
  /** 30..365. Default 90. */
  stale_key_threshold_days: number
  /** Notification-only: GitGuardian HasMySecretLeaked daily scan. Off by default. */
  leak_detection_enabled: boolean
  /** PLG Loop ② — Team+ may hide the "Observed by Spanlens" share footer. */
  hide_powered_by_badge: boolean
  created_at: string
  updated_at: string
}

export interface Project {
  id: string
  name: string
  description: string | null
  created_at: string
  updated_at?: string
}

export type ApiKeyScope = 'full' | 'public'

export interface ApiKey {
  id: string
  /** Null for `public` (workspace-level) keys. */
  project_id: string | null
  /** Set only for `public` keys. */
  organization_id: string | null
  name: string
  key_prefix: string
  scope: ApiKeyScope
  is_active: boolean
  last_used_at: string | null
  created_at: string
}

/** Returned from POST /api/v1/api-keys/issue — `key` is plaintext, shown ONCE. */
export interface IssuedApiKey extends ApiKey {
  key: string
}

export interface ProviderKey {
  id: string
  provider: string
  name: string
  is_active: boolean
  /** Spanlens key (sl_live_*) UUID this provider key belongs to. */
  api_key_id: string
  created_at: string
  updated_at: string
  /**
   * Provider-specific config.
   *   - azure: { resource_url: 'https://x.openai.azure.com' }
   *   - openai/anthropic/gemini: {}
   * Shape varies — callers must narrow before reading. Optional in case
   * the server didn't include it (older API versions).
   */
  provider_metadata?: Record<string, unknown>
  /** MAX(requests.created_at) — null if never used. */
  last_used_at?: string | null
  /** Latest provider_key_leak_scans timestamp; null if never scanned. */
  last_scan_at?: string | null
  /** Latest scan outcome. null = never scanned. */
  last_scan_result?: 'clean' | 'leaked' | 'error' | null
}

export interface RequestRow {
  id: string
  provider: string
  model: string
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  /** Subset of prompt_tokens that hit a prompt cache (charged at reduced rate). */
  cache_read_tokens?: number
  /** Subset of prompt_tokens that wrote a cache entry (charged at premium rate). */
  cache_write_tokens?: number
  cost_usd: number | null
  latency_ms: number
  status_code: number
  error_message: string | null
  trace_id?: string | null
  span_id?: string | null
  provider_key_id?: string | null
  /** Joined from provider_keys.name — null if the key was revoked or never set. */
  provider_key_name?: string | null
  /** Customer-supplied end-user ID (x-spanlens-user header). */
  user_id?: string | null
  /** Customer-supplied session ID (x-spanlens-session header). */
  session_id?: string | null
  /**
   * True when the proxy hit its Vercel function deadline and gracefully
   * closed the stream. Token counts + body reflect whatever was captured
   * up to that point; the dashboard shows a badge so customers can
   * investigate (e.g. shorten max_tokens, switch to a faster model).
   */
  truncated?: boolean
  created_at: string
}

export interface RequestDetail extends RequestRow {
  request_body: unknown
  response_body: unknown
}

export interface RequestsPage {
  data: RequestRow[]
  meta: { total: number; page: number; limit: number }
}

export interface StatsOverview {
  totalRequests: number
  successRequests: number
  errorRequests: number
  totalCostUsd: number
  totalTokens: number
  promptTokens: number
  completionTokens: number
  avgLatencyMs: number
  errorRate: number
  /** Present when compare=true — % change vs previous equal-duration period. null = no prior data. */
  requestsDelta?: number | null
  costDelta?: number | null
  latencyDelta?: number | null
  errorRateDelta?: number | null
}

export interface TimeseriesPoint {
  date: string
  requests: number
  cost: number
  /** Total tokens (prompt + completion). Kept for backward compat. */
  tokens: number
  /** Prompt-side tokens. Optional so demo / older API responses still type-check. */
  promptTokens?: number
  /** Completion-side tokens. Optional for the same reason. */
  completionTokens?: number
  errors: number
  /** 4xx error count (subset of `errors`). Optional for backward compat with the demo data shim. */
  errors4xx?: number
  /** 5xx error count (subset of `errors`). Optional for backward compat with the demo data shim. */
  errors5xx?: number
  /** 429 rate-limit count (subset of `errors4xx`). Optional for backward compat. */
  errors429?: number
  /** Median latency in ms for this bucket. Null when bucket is empty. */
  p50LatencyMs?: number | null
  /** 95th percentile latency in ms for this bucket. Null when bucket is empty. */
  p95LatencyMs?: number | null
}

export interface BucketBreakdownEntry {
  value: string
  count: number
}

export interface TimeseriesBreakdownPoint {
  date: string
  topStatus: BucketBreakdownEntry[]
  topModels: BucketBreakdownEntry[]
}

export interface SpendForecast {
  monthToDate: number
  dayOfMonth: number
  daysInMonth: number
  dailyAvgUsd: number
  projectedMonthEndUsd: number
  weeklyDeltaPct: number | null
  /** Linear regression slope — positive = trending up $/day, negative = trending down */
  dailyTrendUsd: number
  timeseries: { date: string; actual: number | null; projected: number | null }[]
}

// ── User Analytics ─────────────────────────────────────────────

export interface UserAnalyticsRow {
  user_id: string
  total_requests: number
  total_tokens: number
  total_cost_usd: number | null
  avg_latency_ms: number | null
  first_seen: string
  last_seen: string
  error_requests: number
  distinct_models: number
}

export interface UserAnalyticsPage {
  data: UserAnalyticsRow[]
  meta: { total: number; page: number; limit: number }
}

export interface UserAnalyticsDetail extends UserAnalyticsRow {
  recent_requests: Array<{
    id: string
    provider: string
    model: string
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    cache_read_tokens?: number | null
    cache_write_tokens?: number | null
    cost_usd: number | null
    latency_ms: number
    status_code: number
    error_message: string | null
    session_id: string | null
    created_at: string
  }>
}

// ── Agent Tracing ──────────────────────────────────────────────

export type TraceStatus = 'running' | 'completed' | 'error'
export type SpanType = 'llm' | 'tool' | 'retrieval' | 'embedding' | 'custom'

export interface TraceRow {
  id: string
  project_id: string
  name: string
  status: TraceStatus
  started_at: string
  ended_at: string | null
  duration_ms: number | null
  span_count: number
  total_tokens: number
  total_cost_usd: number
  error_message: string | null
  created_at: string
}

export interface SpanRow {
  id: string
  parent_span_id: string | null
  name: string
  span_type: SpanType
  status: TraceStatus
  started_at: string
  ended_at: string | null
  duration_ms: number | null
  input: unknown
  output: unknown
  metadata: Record<string, unknown> | null
  error_message: string | null
  request_id: string | null
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  cost_usd: number | null
}

export interface TraceDetail extends TraceRow {
  metadata: Record<string, unknown> | null
  api_key_id: string | null
  organization_id: string
  updated_at: string
  spans: SpanRow[]
  /** IDs of spans on the critical (longest-latency) path, root→leaf order. */
  critical_span_ids: string[]
}

export interface TracesPage {
  data: TraceRow[]
  meta: { total: number; page: number; limit: number }
}

// ── Billing ────────────────────────────────────────────────────

// ── Session Analytics ──────────────────────────────────────────

export interface SessionAnalyticsRow {
  session_id: string
  user_id: string | null
  total_requests: number
  total_tokens: number
  total_cost_usd: number
  avg_latency_ms: number | null
  first_seen: string
  last_seen: string
  error_requests: number
  distinct_models: number
}

export interface SessionTurn {
  id: string
  provider: string
  model: string
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  cost_usd: number | null
  latency_ms: number
  status_code: number
  error_message: string | null
  trace_id: string | null
  user_id: string | null
  request_body: unknown
  response_body: unknown
  created_at: string
}

export interface SessionDetail {
  session_id: string
  user_id: string | null
  total_requests: number
  total_tokens: number
  total_cost_usd: number
  avg_latency_ms: number | null
  first_seen: string | null
  last_seen: string | null
  error_requests: number
  distinct_models: number
  turns: SessionTurn[]
  turns_truncated: boolean
}

export type BillingPlan = 'free' | 'starter' | 'team' | 'enterprise'
export type SubscriptionStatus =
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'paused'
  | 'canceled'

export interface Subscription {
  id: string
  paddle_subscription_id: string
  paddle_price_id: string
  plan: Exclude<BillingPlan, 'free'>
  status: SubscriptionStatus
  current_period_start: string | null
  current_period_end: string | null
  cancel_at_period_end: boolean
  updated_at: string
}

export interface CheckoutResponse {
  url: string
  transactionId: string
}

// ── Alerts ─────────────────────────────────────────────────────

export type AlertType = 'budget' | 'error_rate' | 'latency_p95' | 'eval_score'
export type ChannelKind = 'email' | 'slack' | 'discord'

export interface AlertRow {
  id: string
  name: string
  type: AlertType
  threshold: number
  window_minutes: number
  cooldown_minutes: number
  is_active: boolean
  last_triggered_at: string | null
  project_id: string | null
  created_at: string
  updated_at: string
}

export interface NotificationChannelRow {
  id: string
  kind: ChannelKind
  target: string
  /** Optional human-readable name, e.g. "#prod-alerts". Null for older rows. */
  label: string | null
  is_active: boolean
  created_at: string
}

/** Per-user email notification preferences (Settings → Notifications). */
export interface UserNotificationPrefs {
  security_alert_emails: boolean
  marketing_emails: boolean
  product_update_emails: boolean
}

export interface AlertDeliveryRow {
  id: string
  alert_id: string
  channel_id: string
  status: 'sent' | 'failed'
  error_message: string | null
  created_at: string
}

// ── Webhooks ───────────────────────────────────────────────────

export type WebhookEvent = 'request.created' | 'trace.completed' | 'alert.triggered'

export interface WebhookRow {
  id: string
  organization_id: string
  name: string
  url: string
  secret: string
  events: WebhookEvent[]
  is_active: boolean
  created_at: string
}

export interface WebhookDeliveryRow {
  id: string
  webhook_id: string
  event_type: string
  status: 'success' | 'failed'
  http_status: number | null
  error_message: string | null
  duration_ms: number | null
  delivered_at: string
}
