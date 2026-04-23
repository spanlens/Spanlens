import type { Transport } from './transport.js'
import { createSpan, SpanHandle } from './span.js'
import type { EndTraceOptions, SpanOptions } from './types.js'

/**
 * Active trace handle. Returned by `client.startTrace()`.
 */
export class TraceHandle {
  readonly traceId: string
  readonly name: string
  readonly startedAt: Date

  /** @internal — in-flight POST /ingest/traces. Spans chain after this. */
  _creationPromise: Promise<unknown> = Promise.resolve()

  private ended = false

  constructor(
    private readonly transport: Transport,
    params: { traceId: string; name: string; startedAt: Date },
  ) {
    this.traceId = params.traceId
    this.name = params.name
    this.startedAt = params.startedAt
  }

  /** Create a top-level (root) span under this trace. */
  span(options: SpanOptions): SpanHandle {
    return createSpan(this.transport, this.traceId, options, this._creationPromise)
  }

  /**
   * End the trace. Idempotent.
   * `duration_ms` is computed server-side from started_at + ended_at.
   *
   * Awaits the trace's own creation POST first — otherwise PATCH could
   * race ahead and target a row that doesn't yet exist (silent 404).
   */
  async end(options: EndTraceOptions = {}): Promise<void> {
    if (this.ended) return
    this.ended = true

    await this._creationPromise.catch(() => undefined)

    const body: Record<string, unknown> = {
      status: options.status ?? (options.errorMessage ? 'error' : 'completed'),
      ended_at: new Date().toISOString(),
    }
    if (options.errorMessage !== undefined) body['error_message'] = options.errorMessage
    if (options.metadata !== undefined) body['metadata'] = options.metadata

    await this.transport.patch(`/ingest/traces/${this.traceId}`, body)
  }
}

export function createTrace(
  transport: Transport,
  name: string,
  metadata?: Record<string, unknown>,
): TraceHandle {
  const traceId = crypto.randomUUID()
  const startedAt = new Date()

  const body: Record<string, unknown> = {
    id: traceId,
    name,
    started_at: startedAt.toISOString(),
  }
  if (metadata !== undefined) body['metadata'] = metadata

  const handle = new TraceHandle(transport, { traceId, name, startedAt })

  // Track the in-flight POST so child spans can chain after it. This prevents
  // a race where a span POST hits the server before the trace INSERT commits,
  // causing the server's ownership check to 404 and the span to be lost.
  // Rejection is swallowed (silent SDK contract).
  handle._creationPromise = transport.post('/ingest/traces', body).catch(() => undefined)

  return handle
}
