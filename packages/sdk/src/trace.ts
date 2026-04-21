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
    return createSpan(this.transport, this.traceId, options)
  }

  /**
   * End the trace. Idempotent.
   * `duration_ms` is computed server-side from started_at + ended_at.
   */
  async end(options: EndTraceOptions = {}): Promise<void> {
    if (this.ended) return
    this.ended = true

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

  // Fire-and-forget; onError hook still fires via the transport,
  // but the Promise rejection is swallowed to avoid unhandledRejection.
  void transport.post('/ingest/traces', body).catch(() => undefined)

  return new TraceHandle(transport, { traceId, name, startedAt })
}
