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
}

export interface TimeseriesPoint {
  date: string
  requests: number
  cost: number
  tokens: number
  errors: number
}
