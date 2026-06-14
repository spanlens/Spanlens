import { createTransport, type Transport } from './transport.js'
import { createTrace, TraceHandle } from './trace.js'
import { makeBufferingTransport, shouldSample, validateSampleRate } from './sampler.js'
import { createEvalsApi, type EvalsApi } from './evals.js'
import type { SpanlensConfig, TraceOptions } from './types.js'

/**
 * Spanlens SDK client — single entry point.
 *
 * @example
 * const client = new SpanlensClient({ apiKey: 'sl_live_...' })
 * const trace = client.startTrace({ name: 'chat_session', metadata: { userId: 'u_42' } })
 * const span = trace.span({ name: 'call_openai', spanType: 'llm' })
 * // ... do work ...
 * await span.end({ totalTokens: 150, costUsd: 0.0023 })
 * await trace.end({ status: 'completed' })
 *
 * @example  Sample 10% of traces; error traces are always recorded.
 * const client = new SpanlensClient({ apiKey: 'sl_live_...', sampleRate: 0.1 })
 */
export class SpanlensClient {
  private readonly transport: Transport
  private readonly sampleRate: number
  private _evals: EvalsApi | undefined

  /** Config kept so the lazily-built evals API can reuse apiKey + baseUrl. */
  private readonly config: SpanlensConfig

  constructor(config: SpanlensConfig) {
    if (!config.apiKey || config.apiKey.trim().length === 0) {
      throw new Error('[spanlens] apiKey is required')
    }
    this.config = config
    this.sampleRate = validateSampleRate(config.sampleRate)
    this.transport = createTransport(config)
  }

  /**
   * Evals API — trigger prompt evaluations from CI / scripts and read back
   * the score to gate on. Blocking and throws on failure (unlike tracing,
   * which is fire-and-forget). Requires a full `sl_live_*` key — a public
   * `sl_live_pub_*` key gets PUBLIC_KEY_WRITE_FORBIDDEN on run().
   */
  get evals(): EvalsApi {
    if (!this._evals) {
      this._evals = createEvalsApi({
        apiKey: this.config.apiKey,
        ...(this.config.baseUrl ? { baseUrl: this.config.baseUrl } : {}),
      })
    }
    return this._evals
  }

  /**
   * Start a new trace. Returns immediately; ingest runs in the background.
   *
   * Sampling happens here — the decision is sticky for the trace's lifetime
   * and applies to every span created under it. When the decision is "drop,"
   * the returned `TraceHandle` still behaves identically to user code (you
   * can create spans, attach metadata, etc.) — calls are buffered in memory
   * and either replayed (if the trace ends with `status: 'error'`) or
   * discarded (otherwise).
   */
  startTrace(options: TraceOptions): TraceHandle {
    const sampled = shouldSample(this.sampleRate)
    // For sampled-in traces, hand the trace the real transport directly —
    // identical behaviour to pre-P3.8. For sampled-out traces, wrap with a
    // buffering transport so child POSTs/PATCHes are queued instead of sent.
    const traceTransport: Transport = sampled
      ? this.transport
      : makeBufferingTransport(this.transport)

    return createTrace(traceTransport, options.name, options.metadata, {
      sampled,
      realTransport: this.transport,
    })
  }

  /**
   * Waits for all in-flight ingest calls to settle.
   * Call this before process exit to ensure no spans are dropped.
   *
   * @example
   * process.on('beforeExit', () => client.flush())
   */
  async flush(): Promise<void> {
    return this.transport.flush()
  }

  /** Exposed for wrappers (openai/anthropic auto-instrumentation). */
  get _transport(): Transport {
    return this.transport
  }
}
