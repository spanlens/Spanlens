/**
 * Vercel AI SDK integration for Spanlens tracing.
 *
 * Records one LLM span per `generateText`, `streamText`, `generateObject`, or
 * `streamObject` call. No direct import from 'ai' — works as a duck-typed
 * integration.
 *
 * How the span is closed depends on the call:
 *   - `streamText` / `streamObject` call `onFinish` / `onError`, so pass
 *     `tracker.onFinish` and `tracker.onError` in the options.
 *   - `generateText` / `generateObject` (AI SDK 4.x and 5.x) have no
 *     `onFinish`; await the call and pass the result to `tracker.end()`.
 *
 * Closing never waits on Spanlens. `onFinish`, `end()` and `onError` stamp
 * `ended_at` on the span (and on the trace the tracker created) the moment
 * they run, queue the PATCHes in the background, and resolve right away.
 * `await client.flush()` before a serverless handler returns, or pass
 * `awaitIngest: true` to wait for delivery inline.
 *
 * Token totals: AI SDK 5.x and later hand `onFinish` the LAST step's `usage`
 * plus the run's sum in `totalUsage`. The tracker prefers `totalUsage`, then
 * the sum of every step seen by `onStepFinish`, then `usage` (which already is
 * the combined total in AI SDK 4.x).
 *
 * @example streamText
 *   import { SpanlensClient } from '@spanlens/sdk'
 *   import { createSpanlensTracker } from '@spanlens/sdk/vercel-ai'
 *
 *   const client = new SpanlensClient({ apiKey: process.env.SPANLENS_API_KEY! })
 *   const tracker = createSpanlensTracker({ client, modelName: 'gpt-4o' })
 *
 *   const result = streamText({
 *     model: openai('gpt-4o'),
 *     messages: [...],
 *     onStepFinish: tracker.onStepFinish,
 *     onFinish: tracker.onFinish,
 *     onError: tracker.onError, // ends the span on failure
 *   })
 *
 * @example generateText
 *   const tracker = createSpanlensTracker({ client, modelName: 'gpt-4o' })
 *   const result = await generateText({
 *     model: openai('gpt-4o'),
 *     messages: [...],
 *     onStepFinish: tracker.onStepFinish,
 *   }).catch((err) => {
 *     void tracker.onError(err) // ends the span on failure
 *     throw err
 *   })
 *   void tracker.end(result)
 *
 * @example Attach to an existing trace
 *   const trace = client.startTrace({ name: 'my_workflow' })
 *   const tracker = createSpanlensTracker({ client, trace, modelName: 'gpt-4o' })
 *   void tracker.end(await generateText({ ... }))
 *   void trace.end()
 */

import { SpanlensClient } from '../client.js'
import type { TraceHandle } from '../trace.js'
import type { EndSpanOptions } from '../types.js'

export interface SpanlensVercelAIOptions {
  /** Spanlens client instance. */
  client: SpanlensClient
  /**
   * Optional trace to attach LLM spans to.
   * When provided, `trace.end()` is NOT called — the caller manages the lifecycle.
   * When omitted, a new trace is created and closed when the span closes.
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
  /**
   * Make `onFinish`, `end()` and `onError` wait until the span (and the
   * auto-created trace) end PATCHes are delivered. Default `false`: they
   * resolve at once and delivery runs in the background (`client.flush()`
   * drains it). Turning this on adds every ingest round trip, and on failure
   * its retries, to the caller's latency.
   */
  awaitIngest?: boolean
}

/**
 * Token usage shape from Vercel AI SDK events and results.
 * AI SDK 4.x uses promptTokens/completionTokens; AI SDK 5.x uses inputTokens/outputTokens.
 * Both are accepted.
 */
export interface VercelAIUsage {
  promptTokens?: number    // AI SDK 4.x
  completionTokens?: number
  inputTokens?: number     // AI SDK 5.x
  outputTokens?: number
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

/**
 * Shape of the `onFinish` event of `streamText` / `streamObject`, and of the
 * awaited result of `generateText` / `generateObject` (pass it to `end()`).
 */
export interface VercelAIFinishEvent {
  /** AI SDK 4.x: combined usage. AI SDK 5.x and later: the last step only. */
  usage?: VercelAIUsage
  /** AI SDK 5.x and later: usage summed over every step. */
  totalUsage?: VercelAIUsage
  finishReason?: string
  text?: string
  /** Structured output of `generateObject` / `streamObject`. Recorded as JSON text. */
  object?: unknown
  response?: {
    id?: string
    modelId?: string
    model?: string
  }
}

export interface SpanlensVercelAITracker {
  /** Pass to `onStepFinish` — counts steps and sums their usage for multi-step runs. */
  onStepFinish: (event: VercelAIStepFinishEvent) => Promise<void>
  /**
   * Pass to `onFinish` (`streamText` / `streamObject`). Closes the span with
   * the run's total usage and resolves without waiting for delivery unless
   * `awaitIngest` is set.
   */
  onFinish: (event: VercelAIFinishEvent) => Promise<void>
  /**
   * Close the span from an awaited `generateText` / `generateObject` result.
   * Those calls have no `onFinish` in AI SDK 4.x and 5.x, so without this the
   * span would stay 'running'. Same behavior as `onFinish`.
   */
  end: (result: VercelAIFinishEvent) => Promise<void>
  /**
   * Pass to `onError` (streamText/streamObject), or call it from a `catch`
   * around `generateText` — closes the span/trace with `status: 'error'`.
   * Without this a failed call leaves the span 'running' forever.
   */
  onError: (event: { error?: unknown } | unknown) => Promise<void>
}

interface TokenCounts {
  readonly promptTokens: number
  readonly completionTokens: number
  readonly totalTokens: number
}

function toTokenCounts(usage: VercelAIUsage | undefined): TokenCounts | null {
  if (!usage) return null
  const promptTokens = usage.promptTokens ?? usage.inputTokens ?? 0
  const completionTokens = usage.completionTokens ?? usage.outputTokens ?? 0
  return {
    promptTokens,
    completionTokens,
    totalTokens: usage.totalTokens ?? promptTokens + completionTokens,
  }
}

function addTokenCounts(a: TokenCounts | null, b: TokenCounts): TokenCounts {
  if (!a) return b
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  }
}

/** Text output, or the structured object serialized as JSON. */
function outputOf(event: VercelAIFinishEvent): string | undefined {
  if (event.text !== undefined) return event.text
  if (event.object === undefined) return undefined
  try {
    return JSON.stringify(event.object)
  } catch {
    return String(event.object)
  }
}

/**
 * Creates a tracker whose `onStepFinish`, `onFinish`, and `onError` methods
 * can be passed directly as AI SDK callbacks, plus `end()` for awaited calls.
 *
 * A new LLM span is started immediately (so latency is measured from the
 * moment the AI call begins). The span is closed by `onFinish` / `end()` or
 * `onError`, whichever comes first.
 */
export function createSpanlensTracker(
  options: SpanlensVercelAIOptions,
): SpanlensVercelAITracker {
  const { client, traceName = 'ai.generate', modelName, awaitIngest = false } = options

  const isLocalTrace = options.trace === undefined
  const trace = options.trace ?? client.startTrace({ name: traceName })
  const span = trace.span({
    name: modelName ? `llm.${modelName}` : 'llm.call',
    spanType: 'llm',
  })

  let stepCount = 0
  let stepTokens: TokenCounts | null = null
  let settled = false

  /**
   * End the span and, when the tracker created it, the trace in the same
   * tick, so both `ended_at` values are the moment the call finished rather
   * than the moment an earlier PATCH was delivered. Both ends are registered
   * with the transport right away, so `client.flush()` drains them.
   */
  function close(spanEnd: EndSpanOptions, status: 'completed' | 'error'): Promise<void> {
    const spanEnded = span.end(spanEnd)
    const traceEnded = isLocalTrace ? trace.end({ status }) : Promise.resolve()
    const delivered = Promise.all([spanEnded, traceEnded]).then(() => undefined)
    if (awaitIngest) return delivered
    // Delivery failures were already reported through the client's onError;
    // under silent:false they must not escape as unhandled rejections either.
    delivered.catch(() => {})
    return Promise.resolve()
  }

  // async so a malformed event rejects instead of throwing synchronously
  // inside an AI SDK callback; close() itself never waits on delivery.
  async function finish(event: VercelAIFinishEvent): Promise<void> {
    if (settled) return
    settled = true
    const { finishReason, response } = event
    const resolvedModel =
      response?.modelId ?? response?.model ?? modelName ?? 'unknown'
    const isError = finishReason === 'error'
    const tokens = toTokenCounts(event.totalUsage) ?? stepTokens ?? toTokenCounts(event.usage)
    const output = outputOf(event)

    return close(
      {
        status: isError ? 'error' : 'completed',
        ...(output !== undefined ? { output } : {}),
        ...(tokens ?? {}),
        metadata: {
          model: resolvedModel,
          ...(finishReason ? { finishReason } : {}),
          ...(stepCount > 1 ? { steps: stepCount } : {}),
        },
      },
      isError ? 'error' : 'completed',
    )
  }

  return {
    async onStepFinish(event: VercelAIStepFinishEvent): Promise<void> {
      stepCount++
      // Step-level detail is recorded as metadata on the final span.
      // Individual steps are not broken out into child spans to keep the
      // trace tree simple for the common case.
      const tokens = toTokenCounts(event?.usage)
      if (tokens) stepTokens = addTokenCounts(stepTokens, tokens)
    },

    onFinish: finish,
    end: finish,

    async onError(event: { error?: unknown } | unknown): Promise<void> {
      // The underlying call errored — end the span/trace so it does not stay
      // 'running' forever. Guarded by `settled` so a later onFinish (or vice
      // versa) does not double-end.
      if (settled) return
      settled = true
      const raw =
        event != null && typeof event === 'object' && 'error' in event
          ? (event as { error?: unknown }).error
          : event
      const errorMessage = raw instanceof Error ? raw.message : String(raw)

      return close(
        { status: 'error', errorMessage, metadata: { model: modelName ?? 'unknown' } },
        'error',
      )
    },
  }
}
