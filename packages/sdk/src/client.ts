import { createTransport, type Transport } from './transport.js'
import { createTrace, TraceHandle } from './trace.js'
import { makeBufferingTransport, shouldSample, validateSampleRate } from './sampler.js'
import { createEvalsApi, type EvalsApi } from './evals.js'
import type { SpanlensConfig, TraceOptions } from './types.js'

/**
 * Key-format warnings fire at most once per process per category so a
 * client constructed in a hot path (per-request factories are common in
 * serverless code) cannot flood the console. Module-level on purpose:
 * the misconfiguration is process-wide, not per-client.
 */
const warnedKeyFormats = new Set<'public' | 'format'>()

/** Test-only helper. Production never calls this. */
export function _resetKeyFormatWarningsForTests(): void {
  warnedKeyFormats.clear()
}

/**
 * Warn (once) when the configured apiKey cannot work for ingest:
 * - `sl_live_pub_*` keys are read-only, so every ingest/proxy call will be
 *   rejected with 403 PUBLIC_KEY_WRITE_FORBIDDEN.
 * - Anything without the `sl_live_` prefix is not a Spanlens key at all
 *   (a pasted provider key like `sk-...` is the classic mixup).
 * Never prints the key itself; only a short masked prefix.
 */
function warnOnKeyFormat(apiKey: string): void {
  if (apiKey.startsWith('sl_live_pub_')) {
    if (warnedKeyFormats.has('public')) return
    warnedKeyFormats.add('public')
    console.warn(
      '[spanlens] apiKey is a public key (sl_live_pub_*). Public keys are read-only: ' +
        'ingest and proxy calls will be rejected with 403 PUBLIC_KEY_WRITE_FORBIDDEN. ' +
        'Create a full sl_live_ key on the Projects & Keys page for tracing. ' +
        'Docs: https://www.spanlens.io/docs/quick-start',
    )
    return
  }
  if (!apiKey.startsWith('sl_live_')) {
    if (warnedKeyFormats.has('format')) return
    warnedKeyFormats.add('format')
    // Deliberately logs nothing derived from the key value, not even a
    // masked prefix (js/clear-text-logging flags any tainted substring).
    console.warn(
      '[spanlens] apiKey does not look like a Spanlens key (expected sl_live_ prefix). ' +
        'A pasted provider key (sk-...) is the usual mixup. ' +
        'Check that SPANLENS_API_KEY holds the key from your Spanlens dashboard. ' +
        'Docs: https://www.spanlens.io/docs/quick-start',
    )
  }
}

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
    warnOnKeyFormat(config.apiKey)
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
