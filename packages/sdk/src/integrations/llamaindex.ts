/**
 * LlamaIndex TS integration for Spanlens tracing.
 *
 * Hooks into LlamaIndex's `Settings.callbackManager` to record LLM spans
 * (model, tokens, latency) for every LLM call made through LlamaIndex.
 * No direct import from 'llamaindex' — works as a duck-typed integration.
 *
 * @example
 *   import { Settings } from 'llamaindex'
 *   import { SpanlensClient } from '@spanlens/sdk'
 *   import { registerSpanlensCallbacks } from '@spanlens/sdk/llamaindex'
 *
 *   const client = new SpanlensClient({ apiKey: process.env.SPANLENS_API_KEY! })
 *   const unregister = registerSpanlensCallbacks(Settings, { client })
 *
 *   // ... run your LlamaIndex queries ...
 *
 *   unregister() // remove callbacks when done (e.g. on process exit)
 *
 * @example Attach to an existing trace
 *   const trace = client.startTrace({ name: 'rag_pipeline' })
 *   const unregister = registerSpanlensCallbacks(Settings, { client, trace })
 *   await queryEngine.query({ query: '...' })
 *   unregister()
 *   await trace.end()
 */

import { SpanlensClient } from '../client.js'
import type { TraceHandle } from '../trace.js'
import type { SpanHandle } from '../span.js'
import type { EndSpanOptions } from '../types.js'

export interface SpanlensLlamaIndexOptions {
  /** Spanlens client instance. */
  client: SpanlensClient
  /**
   * Optional trace to attach LLM spans to.
   * When provided, `trace.end()` is NOT called — the caller manages the lifecycle.
   * When omitted, a new trace is created per LLM call and closed on completion.
   */
  trace?: TraceHandle
  /** Name for auto-created traces. Default: 'llamaindex_run'. */
  traceName?: string
}

/** Minimal CallbackManager interface — only methods we use. */
interface CallbackManager {
  on(event: string, handler: (payload: unknown) => void): void
  off(event: string, handler: (payload: unknown) => void): void
}

/** Minimal Settings shape — only callbackManager is required. */
export interface LlamaIndexSettings {
  callbackManager: CallbackManager
}

/** LlamaIndex `llm-start` event payload. */
interface LLMStartPayload {
  id: string
  messages: unknown[]
}

/** LlamaIndex `llm-end` event payload. */
interface LLMEndPayload {
  id: string
  response: {
    raw?: {
      usage?: {
        input_tokens?: number
        output_tokens?: number
        total_tokens?: number
      }
      model?: string
    }
    message?: unknown
  }
}

function parseLlamaIndexResult(response: LLMEndPayload['response']): EndSpanOptions {
  const usage = response?.raw?.usage
  if (!usage) return {}

  const promptTokens = usage.input_tokens ?? 0
  const completionTokens = usage.output_tokens ?? 0
  const totalTokens = usage.total_tokens ?? promptTokens + completionTokens

  const out: EndSpanOptions = { promptTokens, completionTokens, totalTokens }
  const modelName = response?.raw?.model
  if (modelName) out.metadata = { model: modelName }
  return out
}

/**
 * Registers Spanlens tracing callbacks on a LlamaIndex `CallbackManager`.
 *
 * Returns an `unregister` function — call it to remove the callbacks and
 * release any pending run state (e.g. when cleaning up after a test or
 * when the LlamaIndex query engine is disposed).
 */
export function registerSpanlensCallbacks(
  settings: LlamaIndexSettings,
  options: SpanlensLlamaIndexOptions,
): () => void {
  const { client, traceName = 'llamaindex_run' } = options

  const runs = new Map<
    string,
    { trace: TraceHandle; span: SpanHandle; isLocalTrace: boolean }
  >()

  function onStart(payload: unknown): void {
    const { id, messages } = payload as LLMStartPayload
    const isLocalTrace = options.trace === undefined
    const trace = options.trace ?? client.startTrace({ name: traceName })
    const span = trace.span({ name: 'llm.call', spanType: 'llm', input: messages })
    runs.set(id, { trace, span, isLocalTrace })
  }

  function onEnd(payload: unknown): void {
    const { id, response } = payload as LLMEndPayload
    const run = runs.get(id)
    if (!run) return
    runs.delete(id)

    const parsed = parseLlamaIndexResult(response)

    run.span
      .end({
        status: 'completed',
        ...(response?.message !== undefined ? { output: response.message } : {}),
        ...parsed,
      })
      .catch(() => undefined)

    if (run.isLocalTrace) {
      run.trace.end({ status: 'completed' }).catch(() => undefined)
    }
  }

  settings.callbackManager.on('llm-start', onStart)
  settings.callbackManager.on('llm-end', onEnd)

  return function unregister(): void {
    settings.callbackManager.off('llm-start', onStart)
    settings.callbackManager.off('llm-end', onEnd)
    runs.clear()
  }
}
