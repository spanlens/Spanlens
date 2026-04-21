/**
 * Spanlens SDK public types.
 */

export type SpanType = 'llm' | 'tool' | 'retrieval' | 'embedding' | 'custom'

export type Status = 'running' | 'completed' | 'error'

export interface SpanlensConfig {
  /** Spanlens API key created in the dashboard (sl_live_... or sl_test_...). */
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
  /** Custom error hook — called when an ingest call fails. */
  onError?: (err: unknown, context: string) => void
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
