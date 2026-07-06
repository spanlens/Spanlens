/**
 * Spanlens SDK public types.
 */

export type SpanType = 'llm' | 'tool' | 'retrieval' | 'embedding' | 'custom'

export type Status = 'running' | 'completed' | 'error'

/**
 * Controls how much of each LLM call gets persisted to the dashboard.
 *
 * - `'full'` (default): request_body + response_body are stored as-is,
 *   with API-key pattern masking applied. Best for debugging.
 * - `'meta'`: token counts, latency, cost, status code, and model are
 *   recorded — but the prompt/response bodies are NOT. Use when prompts
 *   may contain PII you don't want stored on the Spanlens side.
 * - `'none'`: same as `'meta'` plus drops `user_id` and `session_id`.
 *   For the strictest data-minimization deployments.
 *
 * Customers needing automatic natural-language PII redaction (emails,
 * card numbers, etc.) should reach out for the Enterprise option —
 * pattern-based redaction is out of scope for this opt-out.
 */
export type LogBodyMode = 'full' | 'meta' | 'none'

export interface SpanlensConfig {
  /**
   * Spanlens API key created in the dashboard (`sl_live_...`). Public keys
   * (`sl_live_pub_...`) are read-only and cannot ingest; the client warns
   * at construction if one is configured.
   */
  apiKey: string
  /** API base URL — default https://spanlens-server.vercel.app. */
  baseUrl?: string
  /**
   * Request timeout in ms for ingest calls. Default 3000ms.
   * Observability calls should not block user code indefinitely.
   */
  timeoutMs?: number
  /** Swallow all errors so instrumentation never crashes user code. Default true. */
  silent?: boolean
  /**
   * Custom error hook — called on every dropped or failed delivery, even
   * under the default `silent: true`. For HTTP failures `err` is a
   * `SpanlensTransportError` (or its `SpanlensApiError` subclass when the
   * server returned its standard envelope) carrying `status`, `code`,
   * `message`, and `endpoint`. Network and timeout failures pass the raw
   * underlying error unchanged. `context` is the failing endpoint, e.g.
   * `"POST /ingest/traces"`.
   */
  onError?: (err: unknown, context: string) => void
  /**
   * Fraction of traces to ingest, in `[0.0, 1.0]`. Default `1.0` (no sampling).
   *
   * Decisions are made per-trace (at `client.startTrace()` time) and apply to
   * every span under that trace, so each surviving trace remains fully
   * coherent in the dashboard.
   *
   * **Tail-based error bypass**: traces that end with `status: 'error'` are
   * always recorded, even when the trace would otherwise have been sampled
   * out. This guarantees 100% of error traces reach the dashboard regardless
   * of how aggressive the sample rate is.
   *
   * **Scope clarification**: only affects the agent-tracing layer
   * (`/ingest/traces`, `/ingest/spans`). Spanlens proxy request logs
   * (`/proxy/*` → ClickHouse `requests` table) are unaffected — every LLM
   * call is still recorded for cost / quota / anomaly tracking.
   */
  sampleRate?: number
}

export interface TraceOptions {
  name: string
  metadata?: Record<string, unknown>
}

export interface SpanOptions {
  name: string
  spanType?: SpanType
  parentSpanId?: string
  input?: unknown
  metadata?: Record<string, unknown>
  /** Link this span to a Spanlens proxy request (set automatically by wrappers). */
  requestId?: string
}

export interface EndTraceOptions {
  status?: Status
  errorMessage?: string
  metadata?: Record<string, unknown>
}

export interface EndSpanOptions {
  status?: Status
  output?: unknown
  errorMessage?: string
  metadata?: Record<string, unknown>
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  costUsd?: number
  requestId?: string
}
