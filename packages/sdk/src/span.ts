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

  /** @internal — in-flight POST /ingest/.../spans. end() and child spans chain after this. */
  _creationPromise: Promise<unknown> = Promise.resolve()

  private ended = false
  private outputCaptured = false

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
    return createSpan(
      this.transport,
      this.traceId,
      {
        ...options,
        parentSpanId: options.parentSpanId ?? this.spanId,
      },
      this._creationPromise,
    )
  }

  /**
   * End the span. Subsequent calls are ignored.
   * Ingest failures are swallowed by the transport (unless `silent: false`).
   *
   * Awaits the span's own creation POST first — otherwise PATCH could race
   * ahead of INSERT and silently 404 (UPDATE matches zero rows).
   */
  async end(options: EndSpanOptions = {}): Promise<void> {
    if (this.ended) {
      // Supplementary output patch: if output wasn't captured in the first end() call,
      // accept it now (e.g. observe() auto-captures the callback return value after a
      // manual span.end({ tokens }) inside a streaming callback).
      if (!this.outputCaptured && options.output !== undefined) {
        this.outputCaptured = true
        await this._creationPromise.catch(() => undefined)
        await this.transport.patch(`/ingest/spans/${this.spanId}`, { output: options.output })
      }
      return
    }
    this.ended = true
    if (options.output !== undefined) this.outputCaptured = true

    await this._creationPromise.catch(() => undefined)

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
 * Internal helper — creates a span and fires the POST in the background,
 * chained after the parent's creation POST so the server sees them in order.
 * The returned SpanHandle is usable immediately (id generated client-side).
 *
 * Why chain: the server's POST /ingest/traces/:id/spans verifies trace
 * ownership by SELECTing the trace row. If the trace POST hasn't committed
 * yet, this 404s and the span is lost. Chaining after the parent's
 * creationPromise (trace POST or parent span POST) guarantees ordering
 * without slowing down user code (which is awaiting the LLM call anyway).
 */
export function createSpan(
  transport: Transport,
  traceId: string,
  options: SpanOptions,
  parentCreationPromise: Promise<unknown> = Promise.resolve(),
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

  const handle = new SpanHandle(transport, {
    spanId,
    traceId,
    name: options.name,
    spanType,
    ...(options.parentSpanId !== undefined ? { parentSpanId: options.parentSpanId } : {}),
    startedAt,
  })

  handle._creationPromise = parentCreationPromise
    .catch(() => undefined)
    .then(() => transport.post(`/ingest/traces/${traceId}/spans`, body))
    .catch(() => undefined)

  return handle
}
