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

export interface ApiKey {
  id: string
  project_id: string
  name: string
  key_prefix: string
  is_active: boolean
  last_used_at: string | null
  created_at: string
}

/** Returned from POST /api/v1/api-keys — `key` is plaintext, shown ONCE. */
export interface CreatedApiKey extends ApiKey {
  key: string
}

export interface ProviderKey {
  id: string
  provider: string
  name: string
  is_active: boolean
  /** null = org-level default; non-null = project-specific override */
  project_id: string | null
  created_at: string
  updated_at: string
}

export interface RequestRow {
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
  trace_id?: string | null
  span_id?: string | null
  provider_key_id?: string | null
  /** Joined from provider_keys.name — null if the key was revoked or never set. */
  provider_key_name?: string | null
  created_at: string
}

export interface RequestDetail extends RequestRow {
  request_body: unknown
  response_body: unknown
  provider_key_prefix?: string | null
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
}

export interface TimeseriesPoint {
  date: string
  requests: number
  cost: number
  tokens: number
  errors: number
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
}

export interface TracesPage {
  data: TraceRow[]
  meta: { total: number; page: number; limit: number }
}

// ── Billing ────────────────────────────────────────────────────

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

export type AlertType = 'budget' | 'error_rate' | 'latency_p95'
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
  is_active: boolean
  created_at: string
}

export interface AlertDeliveryRow {
  id: string
  alert_id: string
  channel_id: string
  status: 'sent' | 'failed'
  error_message: string | null
  created_at: string
}
