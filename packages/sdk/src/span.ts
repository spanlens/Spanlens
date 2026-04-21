import type { Transport } from './transport.js'
import type { EndSpanOptions, SpanOptions, SpanType } from './types.js'

/**
 * Active span handle. Returned by `trace.span()` or `parent.child()`.
 *
 * Fire-and-forget: all ingest calls run in the background. The handle is
 * usable even when offline — the calls simply no-op silently.
 */
export class SpanHandle {
  readonly spanId: string
  readonly traceId: string
  readonly name: string
  readonly spanType: SpanType
  readonly parentSpanId: string | undefined
  readonly startedAt: Date

  private ended = false

  constructor(
    private readonly transport: Transport,
    params: {
      spanId: string
      traceId: string
      name: string
      spanType: SpanType
      parentSpanId?: string
      startedAt: Date
    },
  ) {
    this.spanId = params.spanId
    this.traceId = params.traceId
    this.name = params.name
    this.spanType = params.spanType
    this.parentSpanId = params.parentSpanId
    this.startedAt = params.startedAt
  }

  /**
   * Return HTTP headers that the Spanlens proxy reads to link a proxied LLM
   * call to this span. Pass them to the OpenAI/Anthropic/Gemini SDK via its
   * per-request `headers` option.
   *
   * The proxy populates `requests.trace_id` and `requests.span_id` from these
   * headers, so the dashboard can join spans ↔ raw request logs.
   */
  traceHeaders(): { 'x-trace-id': string; 'x-span-id': string } {
    return {
      'x-trace-id': this.traceId,
      'x-span-id': this.spanId,
    }
  }

  /**
   * Create a nested child span. The child.parent_span_id points at this span's id.
   * Note: `parent_span_id` has no FK in the DB by design, so out-of-order arrival is fine.
   */
  child(options: SpanOptions): SpanHandle {
    return createSpan(this.transport, this.traceId, {
      ...options,
      parentSpanId: options.parentSpanId ?? this.spanId,
    })
  }

  /**
   * End the span. Subsequent calls are ignored.
   * Ingest failures are swallowed by the transport (unless `silent: false`).
   */
  async end(options: EndSpanOptions = {}): Promise<void> {
    if (this.ended) return
    this.ended = true

    const body: Record<string, unknown> = {
      status: options.status ?? (options.errorMessage ? 'error' : 'completed'),
      ended_at: new Date().toISOString(),
    }
    if (options.output !== undefined) body['output'] = options.output
    if (options.errorMessage !== undefined) body['error_message'] = options.errorMessage
    if (options.metadata !== undefined) body['metadata'] = options.metadata
    if (options.promptTokens !== undefined) body['prompt_tokens'] = options.promptTokens
    if (options.completionTokens !== undefined) body['completion_tokens'] = options.completionTokens
    if (options.totalTokens !== undefined) body['total_tokens'] = options.totalTokens
    if (options.costUsd !== undefined) body['cost_usd'] = options.costUsd
    if (options.requestId !== undefined) body['request_id'] = options.requestId

    await this.transport.patch(`/ingest/spans/${this.spanId}`, body)
  }
}

/**
 * Internal helper — creates a span and fires the POST in the background.
 * The returned SpanHandle is usable immediately (id generated client-side).
 */
export function createSpan(
  transport: Transport,
  traceId: string,
  options: SpanOptions,
): SpanHandle {
  const spanId = crypto.randomUUID()
  const startedAt = new Date()
  const spanType: SpanType = options.spanType ?? 'custom'

  const body: Record<string, unknown> = {
    id: spanId,
    name: options.name,
    span_type: spanType,
    started_at: startedAt.toISOString(),
  }
  if (options.parentSpanId !== undefined) body['parent_span_id'] = options.parentSpanId
  if (options.input !== undefined) body['input'] = options.input
  if (options.metadata !== undefined) body['metadata'] = options.metadata
  if (options.requestId !== undefined) body['request_id'] = options.requestId

  // Fire-and-forget — don't block caller on network.
  // Background rejection is silenced to avoid unhandledRejection; the
  // transport's onError hook still fires for visibility.
  void transport.post(`/ingest/traces/${traceId}/spans`, body).catch(() => undefined)

  return new SpanHandle(transport, {
    spanId,
    traceId,
    name: options.name,
    spanType,
    ...(options.parentSpanId !== undefined ? { parentSpanId: options.parentSpanId } : {}),
    startedAt,
  })
}
