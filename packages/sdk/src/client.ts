import { createTransport, type Transport } from './transport.js'
import { createTrace, TraceHandle } from './trace.js'
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
 */
export class SpanlensClient {
  private readonly transport: Transport

  constructor(config: SpanlensConfig) {
    if (!config.apiKey || config.apiKey.trim().length === 0) {
      throw new Error('[spanlens] apiKey is required')
    }
    this.transport = createTransport(config)
  }

  /** Start a new trace. Returns immediately; ingest runs in the background. */
  startTrace(options: TraceOptions): TraceHandle {
    return createTrace(this.transport, options.name, options.metadata)
  }

  /** Exposed for wrappers (openai/anthropic auto-instrumentation). */
  get _transport(): Transport {
    return this.transport
  }
}
