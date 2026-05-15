/**
 * LangChain JS callback handler for Spanlens tracing.
 *
 * Records LLM spans (model, tokens, latency) from any LangChain chain or LLM.
 * Designed as a duck-typed integration — no direct import from @langchain/core.
 *
 * @example
 *   import { SpanlensClient } from '@spanlens/sdk'
 *   import { createSpanlensCallbackHandler } from '@spanlens/sdk/langchain'
 *
 *   const client = new SpanlensClient({ apiKey: process.env.SPANLENS_API_KEY! })
 *   const handler = createSpanlensCallbackHandler({ client })
 *
 *   const result = await chain.invoke({ input }, { callbacks: [handler] })
 *   // or: const res = await llm.invoke(prompt, { callbacks: [handler] })
 */

import { SpanlensClient } from '../client.js'
import type { TraceHandle } from '../trace.js'
import type { SpanHandle } from '../span.js'
import type { EndSpanOptions } from '../types.js'

export interface SpanlensLangChainOptions {
  /** Spanlens client instance. */
  client: SpanlensClient
  /**
   * Optional trace to attach LLM spans to.
   * When provided, `trace.end()` is NOT called — the caller manages the lifecycle.
   * When omitted, a new trace is created per LLM run and closed on completion.
   */
  trace?: TraceHandle
  /** Name for auto-created traces. Default: 'langchain_run'. */
  traceName?: string
}

/** Minimal LangChain Serialized shape — only fields we use. */
interface LangChainSerialized {
  id?: string[]
  name?: string
}

interface LangChainTokenUsage {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
}

interface LangChainLLMResult {
  llmOutput?: {
    tokenUsage?: LangChainTokenUsage
    model_name?: string
  }
  generations?: ReadonlyArray<ReadonlyArray<{ text?: string }>>
}

function parseLangChainResult(result: LangChainLLMResult): EndSpanOptions {
  const usage = result.llmOutput?.tokenUsage
  if (!usage) return {}

  const promptTokens = usage.promptTokens ?? 0
  const completionTokens = usage.completionTokens ?? 0
  const totalTokens = usage.totalTokens ?? promptTokens + completionTokens

  const out: EndSpanOptions = { promptTokens, completionTokens, totalTokens }
  const modelName = result.llmOutput?.model_name
  if (modelName) out.metadata = { model: modelName }
  return out
}

/**
 * Returns a LangChain-compatible callback handler that records LLM spans to Spanlens.
 *
 * Pass the returned object to the `callbacks` option of any LangChain chain, LLM,
 * or `RunnableConfig`. Concurrent runs are tracked by LangChain's `runId`.
 */
export function createSpanlensCallbackHandler(options: SpanlensLangChainOptions) {
  const { client, traceName = 'langchain_run' } = options

  const runs = new Map<
    string,
    { trace: TraceHandle; span: SpanHandle; isLocalTrace: boolean }
  >()

  function startRun(runId: string, llm: LangChainSerialized, input: unknown): void {
    const spanName = `llm.${llm.id?.at(-1) ?? llm.name ?? 'call'}`
    const isLocalTrace = options.trace === undefined
    const trace = options.trace ?? client.startTrace({ name: traceName })
    const span = trace.span({ name: spanName, spanType: 'llm', input })
    runs.set(runId, { trace, span, isLocalTrace })
  }

  return {
    name: 'SpanlensCallbackHandler' as const,

    handleLLMStart(llm: LangChainSerialized, prompts: string[], runId: string): void {
      startRun(runId, llm, prompts)
    },

    handleChatModelStart(
      llm: LangChainSerialized,
      messages: unknown[][],
      runId: string,
    ): void {
      startRun(runId, llm, messages)
    },

    async handleLLMEnd(output: LangChainLLMResult, runId: string): Promise<void> {
      const run = runs.get(runId)
      if (!run) return
      runs.delete(runId)

      const parsed = parseLangChainResult(output)
      const outputText = output.generations?.[0]?.[0]?.text

      await run.span.end({
        status: 'completed',
        ...(outputText !== undefined ? { output: outputText } : {}),
        ...parsed,
      })

      if (run.isLocalTrace) await run.trace.end({ status: 'completed' })
    },

    async handleLLMError(err: unknown, runId: string): Promise<void> {
      const run = runs.get(runId)
      if (!run) return
      runs.delete(runId)

      const errorMessage = err instanceof Error ? err.message : String(err)
      await run.span.end({ status: 'error', errorMessage })
      if (run.isLocalTrace) await run.trace.end({ status: 'error', errorMessage })
    },
  }
}
