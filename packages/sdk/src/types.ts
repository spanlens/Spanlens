export interface SpanlensConfig {
  apiKey: string
  baseUrl?: string
}

export interface TraceOptions {
  name: string
  metadata?: Record<string, unknown>
}

export interface SpanOptions {
  name: string
  parentSpanId?: string
  metadata?: Record<string, unknown>
}

export interface Trace {
  traceId: string
  name: string
  startedAt: Date
}

export interface Span {
  spanId: string
  traceId: string
  name: string
  parentSpanId?: string | undefined
  startedAt: Date
  end: (output?: unknown) => Promise<void>
}
