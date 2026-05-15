/**
 * Vercel AI SDK integration for Spanlens tracing.
 *
 * Records LLM spans from `generateText`, `streamText`, `generateObject`, and
 * `streamObject` via their `onFinish` / `onStepFinish` callbacks.
 * No direct import from 'ai' — works as a duck-typed integration.
 *
 * @example Basic usage with generateText
 *   import { SpanlensClient } from '@spanlens/sdk'
 *   import { createSpanlensTracker } from '@spanlens/sdk/vercel-ai'
 *
 *   const client = new SpanlensClient({ apiKey: process.env.SPANLENS_API_KEY! })
 *   const tracker = createSpanlensTracker({ client, modelName: 'gpt-4o' })
 *
 *   const result = await generateText({
 *     model: openai('gpt-4o'),
 *     messages: [...],
 *     onStepFinish: tracker.onStepFinish,
 *     onFinish: tracker.onFinish,
 *   })
 *
 * @example Attach to an existing trace
 *   const trace = client.startTrace({ name: 'my_workflow' })
 *   const tracker = createSpanlensTracker({ client, trace, modelName: 'gpt-4o' })
 *   await generateText({ ..., onFinish: tracker.onFinish })
 *   await trace.end()
 */

import { SpanlensClient } from '../client.js'
import type { TraceHandle } from '../trace.js'

export interface SpanlensVercelAIOptions {
  /** Spanlens client instance. */
  client: SpanlensClient
  /**
   * Optional trace to attach LLM spans to.
   * When provided, `trace.end()` is NOT called — the caller manages the lifecycle.
   * When omitted, a new trace is created and closed on `onFinish`.
   */
  trace?: TraceHandle
  /** Name for auto-created traces. Default: 'ai.generate'. */
  traceName?: string
  /**
   * Model name label for the span (e.g. 'gpt-4o', 'claude-3-5-sonnet').
   * Used to name the span; the actual modelId from the response overrides
   * `metadata.model` if available.
   */
  modelName?: string
}

/** Token usage shape from Vercel AI SDK `onFinish` / `onStepFinish` events. */
export interface VercelAIUsage {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
}

/** Shape of the `onStepFinish` event from `generateText` / `streamText`. */
export interface VercelAIStepFinishEvent {
  usage?: VercelAIUsage
  finishReason?: string
  text?: string
  stepType?: string
  isContinued?: boolean
  response?: {
    id?: string
    modelId?: string
    model?: string
  }
}

/** Shape of the `onFinish` event from `generateText` / `streamText`. */
export interface VercelAIFinishEvent {
  usage?: VercelAIUsage
  finishReason?: string
  text?: string
  response?: {
    id?: string
    modelId?: string
    model?: string
  }
}

export interface SpanlensVercelAITracker {
  /** Pass to `onStepFinish` — records intermediate steps for multi-tool runs. */
  onStepFinish: (event: VercelAIStepFinishEvent) => Promise<void>
  /** Pass to `onFinish` — closes the span with final total usage. */
  onFinish: (event: VercelAIFinishEvent) => Promise<void>
}

/**
 * Creates a tracker object whose `onStepFinish` and `onFinish` methods can be
 * spread directly into `generateText` / `streamText` options.
 *
 * A new LLM span is started immediately (so latency is measured from the
 * moment the AI call begins). The span is closed when `onFinish` fires.
 */
export function createSpanlensTracker(
  options: SpanlensVercelAIOptions,
): SpanlensVercelAITracker {
  const { client, traceName = 'ai.generate', modelName } = options

  const isLocalTrace = options.trace === undefined
  const trace = options.trace ?? client.startTrace({ name: traceName })
  const span = trace.span({
    name: modelName ? `llm.${modelName}` : 'llm.call',
    spanType: 'llm',
  })

  let stepCount = 0

  return {
    async onStepFinish(_event: VercelAIStepFinishEvent): Promise<void> {
      stepCount++
      // Step-level detail is recorded as metadata on the final span.
      // Individual steps are not broken out into child spans to keep the
      // trace tree simple for the common case.
    },

    async onFinish(event: VercelAIFinishEvent): Promise<void> {
      const { usage, finishReason, text, response } = event
      const resolvedModel =
        response?.modelId ?? response?.model ?? modelName ?? 'unknown'
      const isError = finishReason === 'error'

      const promptTokens = usage?.promptTokens ?? 0
      const completionTokens = usage?.completionTokens ?? 0
      const totalTokens =
        usage?.totalTokens ?? promptTokens + completionTokens

      await span.end({
        status: isError ? 'error' : 'completed',
        ...(text !== undefined ? { output: text } : {}),
        ...(usage ? { promptTokens, completionTokens, totalTokens } : {}),
        metadata: {
          model: resolvedModel,
          ...(finishReason ? { finishReason } : {}),
          ...(stepCount > 1 ? { steps: stepCount } : {}),
        },
      })

      if (isLocalTrace) {
        await trace.end({ status: isError ? 'error' : 'completed' })
      }
    },
  }
}
