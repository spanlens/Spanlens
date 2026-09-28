import type { Transport } from './transport.js'
import type { BufferingTransport } from './sampler.js'
import { createSpan, SpanHandle } from './span.js'
import type { EndTraceOptions, SpanOptions } from './types.js'

/**
 * Sampling context attached to every trace at construction time. When
 * `sampled` is true the trace behaves exactly as pre-P3.8: every POST/PATCH
 * flows through the real transport immediately. When `sampled` is false the
 * trace's transport is a `BufferingTransport` (queues ops in memory) and
 * `realTransport` is the underlying network transport used for replay-on-error.
 */
export interface TraceSampling {
  readonly sampled: boolean
  readonly realTransport: Transport
}

/**
 * Active trace handle. Returned by `client.startTrace()`.
 */
export class TraceHandle {
  readonly traceId: string
  readonly name: string
  readonly startedAt: Date

  /** @internal — in-flight POST /ingest/traces. Spans chain after this. */
  _creationPromise: Promise<unknown> = Promise.resolve()

  /** @internal — sampling decision + real transport (for tail-based error replay). */
  readonly _sampling: TraceSampling

  private ended = false

  constructor(
    private readonly transport: Transport,
    params: { traceId: string; name: string; startedAt: Date; sampling: TraceSampling },
  ) {
    this.traceId = params.traceId
    this.name = params.name
    this.startedAt = params.startedAt
    this._sampling = params.sampling
  }

  /** Create a top-level (root) span under this trace. */
  span(options: SpanOptions): SpanHandle {
    return createSpan(this.transport, this.traceId, options, this._creationPromise)
  }

  /**
   * End the trace. Idempotent.
   * `duration_ms` is computed server-side from started_at + ended_at.
   *
   * `ended_at` is stamped right now, when end() is called. The PATCH waits for
   * the trace's own creation POST (otherwise it could race ahead and target a
   * row that doesn't yet exist, a silent 404) and is registered with the
   * transport at once, so `client.flush()` drains it even when this promise is
   * never awaited.
   *
   * Sampling semantics:
   *   - sampled-in trace → behaves exactly as before; the PATCH goes through
   *     the real transport.
   *   - sampled-out trace + status='error' → flush buffered span/trace POSTs
   *     to the real transport first (tail-based error bypass), then send the
   *     end PATCH directly to the real transport. The result on the dashboard
   *     is identical to a sampled-in error trace.
   *   - sampled-out trace + status='completed' → drop the buffer silently;
   *     no network traffic for this trace's ingest layer.
   */
  end(options: EndTraceOptions = {}): Promise<void> {
    if (this.ended) return Promise.resolve()
    this.ended = true

    const status = options.status ?? (options.errorMessage ? 'error' : 'completed')

    const body: Record<string, unknown> = {
      status,
      ended_at: new Date().toISOString(),
    }
    if (options.errorMessage !== undefined) body['error_message'] = options.errorMessage
    if (options.metadata !== undefined) body['metadata'] = options.metadata

    const path = `/ingest/traces/${this.traceId}`
    const created = this._creationPromise.catch(() => undefined)

    if (this._sampling.sampled) {
      // Fast path — identical to pre-P3.8 behaviour.
      return this.transport.track(
        created.then(() => this.transport.patch(path, body)).then(() => undefined),
      )
    }

    // Completed / running with no error → drop everything. Nothing to send.
    if (status !== 'error') return Promise.resolve()

    // Sampled-out error. The trace's `transport` is the BufferingTransport that
    // has been queuing every span POST/PATCH so far. Tail-based bypass: replay
    // the buffered ops via the real transport (flushBuffered first waits for
    // span ends that were scheduled but not yet queued), then send the
    // end-PATCH directly to the real transport so it isn't re-buffered.
    const buffering = this.transport as BufferingTransport
    const real = this._sampling.realTransport
    return real.track(
      created
        .then(() => buffering.flushBuffered())
        .then(() => real.patch(path, body))
        .then(() => undefined),
    )
  }
}

export function createTrace(
  transport: Transport,
  name: string,
  metadata: Record<string, unknown> | undefined,
  sampling: TraceSampling,
): TraceHandle {
  const traceId = crypto.randomUUID()
  const startedAt = new Date()

  const body: Record<string, unknown> = {
    id: traceId,
    name,
    started_at: startedAt.toISOString(),
  }
  if (metadata !== undefined) body['metadata'] = metadata

  const handle = new TraceHandle(transport, { traceId, name, startedAt, sampling })

  // Track the in-flight POST so child spans can chain after it. This prevents
  // a race where a span POST hits the server before the trace INSERT commits,
  // causing the server's ownership check to 404 and the span to be lost.
  // Rejection is swallowed (silent SDK contract).
  //
  // For sampled-out traces this POST goes into the BufferingTransport queue
  // instead of hitting the network; replay-on-error preserves ordering.
  handle._creationPromise = transport.post('/ingest/traces', body).catch(() => undefined)

  return handle
}
