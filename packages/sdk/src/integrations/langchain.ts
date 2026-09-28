/**
 * LangChain JS callback handler for Spanlens tracing.
 *
 * Records LLM / chain / tool / retriever spans from any LangChain or LangGraph
 * runnable. Designed as a duck-typed integration — no direct import from
 * `@langchain/core` — so it survives LangChain major version bumps.
 *
 * LangGraph reuses LangChain's `BaseCallbackHandler` contract, so this handler
 * works equally well for plain LangChain chains, LCEL pipelines, and LangGraph
 * compiled graphs. The `runId` / `parentRunId` pair on every callback gives a
 * span tree that mirrors the graph topology 1:1 — graph → node → llm/tool.
 *
 * @example
 *   import { SpanlensClient } from '@spanlens/sdk'
 *   import { createSpanlensCallbackHandler } from '@spanlens/sdk/langchain'
 *
 *   const client = new SpanlensClient({ apiKey: process.env.SPANLENS_API_KEY! })
 *   const handler = createSpanlensCallbackHandler({ client })
 *
 *   // LangChain
 *   await chain.invoke({ input }, { callbacks: [handler] })
 *
 *   // LangGraph
 *   const graph = workflow.compile()
 *   await graph.invoke({ input }, { callbacks: [handler] })
 */

import { SpanlensClient } from '../client.js'
import type { TraceHandle } from '../trace.js'
import type { SpanHandle } from '../span.js'
import type { EndSpanOptions, SpanOptions, SpanType } from '../types.js'

export interface SpanlensLangChainOptions {
  /** Spanlens client instance. */
  client: SpanlensClient
  /**
   * Optional pre-existing trace to attach all spans to. When provided,
   * `trace.end()` is NOT called — the caller owns the lifecycle.
   * When omitted, every top-level run gets a trace of its own, opened when
   * the run starts and closed (with that run's status) when it ends, so
   * overlapping invocations on one shared handler never mix.
   */
  trace?: TraceHandle
  /** Name for auto-created traces. Default: 'langchain_run'. */
  traceName?: string
  /** Capture chain (LangGraph node, LCEL step) spans. Default: true. */
  captureChains?: boolean
  /** Capture tool call spans. Default: true. */
  captureTools?: boolean
  /** Capture retriever spans. Default: true. */
  captureRetrieval?: boolean
  /**
   * Max UTF-8 bytes of JSON to keep in `span.input`. Anything larger is
   * replaced with a `{ __truncated: true, preview, originalBytes }` marker
   * (preview capped at the same byte count, never cut mid-character) so the
   * dashboard still shows something useful. Default 16,384 (16 KB).
   */
  maxInputBytes?: number
  /** Same as `maxInputBytes` but for `span.output`. Default 16,384. */
  maxOutputBytes?: number
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

interface LangChainDocument {
  pageContent?: string
  metadata?: Record<string, unknown>
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

const utf8Encoder = new TextEncoder()
const utf8Decoder = new TextDecoder()

/**
 * JSON-encode and truncate at `maxBytes` UTF-8 bytes. Returns the original
 * value when it fits (so the dashboard receives structured JSON), or a
 * truncation marker object otherwise.
 *
 * Sizes are UTF-8 bytes, not string `.length` (UTF-16 code units), which
 * undercounted CJK text about 3x and emoji about 2x. The preview is cut on a
 * character boundary, so it never ends in half a surrogate pair.
 *
 * Non-serializable values (functions, circular refs) fall back to a string
 * representation rather than throwing — span ingest must never crash the
 * caller's code.
 */
function truncate(value: unknown, maxBytes: number): unknown {
  if (value == null) return value
  const bytes = utf8Encoder.encode(toJson(value))
  if (bytes.length <= maxBytes) return value
  return {
    __truncated: true,
    preview: utf8Prefix(bytes, maxBytes),
    originalBytes: bytes.length,
  }
}

function toJson(value: unknown): string {
  try {
    // JSON.stringify returns undefined (not a string) for functions/symbols.
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

/** Longest prefix of `bytes` that is at most `maxBytes` long and ends on a character boundary. */
function utf8Prefix(bytes: Uint8Array, maxBytes: number): string {
  let end = Math.max(0, Math.min(maxBytes, bytes.length))
  // UTF-8 continuation bytes look like 0b10xxxxxx; back up to a lead byte.
  while (end > 0 && ((bytes[end] ?? 0) & 0xc0) === 0x80) end--
  return utf8Decoder.decode(bytes.subarray(0, end))
}

/**
 * Best-effort name for a Serialized class blob.
 * `id` is typically `['langchain', 'tools', 'TavilySearch']` etc.; falling back
 * to `name` or `'call'` keeps the span readable even when LangChain stops
 * populating one field.
 */
function shortName(s: LangChainSerialized | undefined, fallback: string): string {
  return s?.id?.at(-1) ?? s?.name ?? fallback
}

interface RunRecord {
  readonly span: SpanHandle
  /** Trace this run's span lives in: its root's trace, or the caller's. */
  readonly trace: TraceHandle
  /** True only for a root run whose trace this handler opened; it closes it. */
  readonly ownsTrace: boolean
}

/**
 * Returns a LangChain-compatible callback handler that records LLM, chain,
 * tool, and retriever spans to Spanlens.
 *
 * Pass the returned object to the `callbacks` option of any LangChain chain,
 * LLM, agent, or LangGraph compiled graph. Concurrent runs are tracked by
 * LangChain's per-run UUIDs and every top-level run gets its own trace, so a
 * single handler instance is safe to share across parallel invocations.
 */
export function createSpanlensCallbackHandler(
  options: SpanlensLangChainOptions,
) {
  const { client } = options
  const traceName = options.traceName ?? 'langchain_run'
  const captureChains = options.captureChains ?? true
  const captureTools = options.captureTools ?? true
  const captureRetrieval = options.captureRetrieval ?? true
  const maxInputBytes = options.maxInputBytes ?? 16_384
  const maxOutputBytes = options.maxOutputBytes ?? 16_384

  const runs = new Map<string, RunRecord>()
  const externalTrace = options.trace ?? null

  /**
   * Record a run's span. A run whose parent is being tracked nests under it
   * (same trace). Anything else is a root: it attaches to the caller's trace,
   * or opens a trace of its own that it alone will close. Per-root traces are
   * what keep overlapping invocations on a shared handler apart.
   */
  function startSpan(
    runId: string,
    parentRunId: string | undefined,
    spanOpts: SpanOptions,
  ): void {
    if (runs.has(runId)) {
      // Duplicate start (LangChain shouldn't, but be defensive).
      return
    }
    const parentRecord = parentRunId ? runs.get(parentRunId) : undefined
    if (parentRecord) {
      runs.set(runId, {
        span: parentRecord.span.child(spanOpts),
        trace: parentRecord.trace,
        ownsTrace: false,
      })
      return
    }
    const trace = externalTrace ?? client.startTrace({ name: traceName })
    runs.set(runId, {
      span: trace.span(spanOpts),
      trace,
      ownsTrace: externalTrace === null,
    })
  }

  /** End a span by runId; a root that opened its trace also closes it with its own status. */
  async function endSpan(
    runId: string,
    end: EndSpanOptions,
  ): Promise<void> {
    const record = runs.get(runId)
    if (!record) return
    runs.delete(runId)
    // Both ends are scheduled right away (ended_at stamped now); a sampled-out
    // error trace still waits for the span end before replaying.
    const spanEnded = record.span.end(end)
    const traceEnded = record.ownsTrace
      ? record.trace.end({ status: end.status === 'error' ? 'error' : 'completed' })
      : Promise.resolve()
    await Promise.all([spanEnded, traceEnded])
  }

  function buildSpanOptions(
    name: string,
    spanType: SpanType,
    input?: unknown,
  ): SpanOptions {
    const opts: SpanOptions = { name, spanType }
    if (input !== undefined) {
      const trimmed = truncate(input, maxInputBytes)
      if (trimmed !== undefined) opts.input = trimmed
    }
    return opts
  }

  return {
    name: 'SpanlensCallbackHandler' as const,

    // ── LLM ────────────────────────────────────────────────────────────────

    handleLLMStart(
      llm: LangChainSerialized,
      prompts: string[],
      runId: string,
      parentRunId?: string,
    ): void {
      startSpan(
        runId,
        parentRunId,
        buildSpanOptions(`llm.${shortName(llm, 'call')}`, 'llm', prompts),
      )
    },

    handleChatModelStart(
      llm: LangChainSerialized,
      messages: unknown[][],
      runId: string,
      parentRunId?: string,
    ): void {
      startSpan(
        runId,
        parentRunId,
        buildSpanOptions(`llm.${shortName(llm, 'call')}`, 'llm', messages),
      )
    },

    async handleLLMEnd(output: LangChainLLMResult, runId: string): Promise<void> {
      const parsed = parseLangChainResult(output)
      const outputText = output.generations?.[0]?.[0]?.text
      const end: EndSpanOptions = { status: 'completed', ...parsed }
      if (outputText !== undefined) {
        const trimmed = truncate(outputText, maxOutputBytes)
        if (trimmed !== undefined) end.output = trimmed
      }
      await endSpan(runId, end)
    },

    async handleLLMError(err: unknown, runId: string): Promise<void> {
      const errorMessage = err instanceof Error ? err.message : String(err)
      await endSpan(runId, { status: 'error', errorMessage })
    },

    // ── Chain (LangGraph nodes, LCEL steps, plain chains) ─────────────────

    handleChainStart(
      chain: LangChainSerialized,
      inputs: unknown,
      runId: string,
      _runType?: string,
      _tags?: string[],
      _metadata?: Record<string, unknown>,
      _runName?: string,
      parentRunId?: string,
    ): void {
      if (!captureChains) return
      startSpan(
        runId,
        parentRunId,
        buildSpanOptions(`chain.${shortName(chain, 'run')}`, 'custom', inputs),
      )
    },

    async handleChainEnd(outputs: unknown, runId: string): Promise<void> {
      if (!captureChains) return
      const trimmed = truncate(outputs, maxOutputBytes)
      await endSpan(runId, {
        status: 'completed',
        ...(trimmed !== undefined ? { output: trimmed } : {}),
      })
    },

    async handleChainError(err: unknown, runId: string): Promise<void> {
      if (!captureChains) return
      const errorMessage = err instanceof Error ? err.message : String(err)
      await endSpan(runId, { status: 'error', errorMessage })
    },

    // ── Tool ───────────────────────────────────────────────────────────────

    handleToolStart(
      tool: LangChainSerialized,
      input: string,
      runId: string,
      parentRunId?: string,
    ): void {
      if (!captureTools) return
      startSpan(
        runId,
        parentRunId,
        buildSpanOptions(`tool.${shortName(tool, 'call')}`, 'tool', input),
      )
    },

    async handleToolEnd(output: unknown, runId: string): Promise<void> {
      if (!captureTools) return
      const trimmed = truncate(output, maxOutputBytes)
      await endSpan(runId, {
        status: 'completed',
        ...(trimmed !== undefined ? { output: trimmed } : {}),
      })
    },

    async handleToolError(err: unknown, runId: string): Promise<void> {
      if (!captureTools) return
      const errorMessage = err instanceof Error ? err.message : String(err)
      await endSpan(runId, { status: 'error', errorMessage })
    },

    // ── Retriever ──────────────────────────────────────────────────────────

    handleRetrieverStart(
      retriever: LangChainSerialized,
      query: string,
      runId: string,
      parentRunId?: string,
    ): void {
      if (!captureRetrieval) return
      startSpan(
        runId,
        parentRunId,
        buildSpanOptions(
          `retrieval.${shortName(retriever, 'query')}`,
          'retrieval',
          query,
        ),
      )
    },

    async handleRetrieverEnd(
      documents: LangChainDocument[],
      runId: string,
    ): Promise<void> {
      if (!captureRetrieval) return
      // Surface just text + metadata count so output stays readable when
      // a retriever returns 50+ docs.
      const summarised = documents.map((d) => ({
        pageContent: d.pageContent,
        metadata: d.metadata,
      }))
      const trimmed = truncate(summarised, maxOutputBytes)
      await endSpan(runId, {
        status: 'completed',
        ...(trimmed !== undefined ? { output: trimmed } : {}),
      })
    },

    async handleRetrieverError(err: unknown, runId: string): Promise<void> {
      if (!captureRetrieval) return
      const errorMessage = err instanceof Error ? err.message : String(err)
      await endSpan(runId, { status: 'error', errorMessage })
    },
  }
}
