/**
 * Internal tracing — Spanlens instruments itself with Spanlens.
 *
 * Every eval / experiment / playground run on our own server posts a
 * trace + spans to the public ingest API of a dedicated "spanlens-team"
 * workspace, so we can see our own eval cost, latency, error rate on
 * the same /traces view our customers use.
 *
 * Design constraints:
 *
 *   • Fail-open. If the internal API key is missing, the upstream is
 *     down, or any single fetch errors, the runner that called us
 *     MUST continue uninterrupted. Customer evals cannot fail because
 *     our own observability stopped working.
 *
 *   • Hot-path latency must be negligible. Returning the trace/span
 *     handle immediately while the underlying POST runs in the
 *     background is the same trick `packages/sdk` uses (gotcha #10 in
 *     CLAUDE.md). The handle chains its `_creationPromise` so a child
 *     span POST waits for the parent's INSERT to commit before the
 *     server checks ownership.
 *
 *   • Cron / Edge friendly. The runner is invoked via
 *     `fireAndForget(c, runEvalRun(...))` which means the function body
 *     keeps running after the HTTP response is sent. We do NOT use
 *     `c.executionCtx` here because it isn't always available.
 *
 *   • No SDK import. The official SDK has heavier deps + a bigger
 *     surface area. A 200-line local wrapper is faster to audit and
 *     keeps `apps/server` cold-start lean. If the wire format changes
 *     we only have one file to update.
 *
 * Env vars (read once at module load):
 *
 *   SPANLENS_INTERNAL_BASE_URL  https://api.spanlens.io  (or local)
 *   SPANLENS_INTERNAL_API_KEY   sl_live_<hex>               (full-scope key
 *                                                            of the
 *                                                            spanlens-team
 *                                                            workspace)
 *
 * When either is missing the module degrades to no-op: every public
 * function returns a stub handle whose .end() is a no-op. This is the
 * only safe default for local dev and CI — nobody else should ever ship
 * traces to our internal workspace.
 */

const BASE_URL = process.env['SPANLENS_INTERNAL_BASE_URL']
const API_KEY = process.env['SPANLENS_INTERNAL_API_KEY']

/**
 * `true` when both env vars are present. We snapshot this once so a
 * hot-path branch is a single boolean check, not a string compare.
 */
const ENABLED = Boolean(BASE_URL && API_KEY)

interface InternalIngestSuccess { success: true; data: { id: string } }
interface InternalIngestError { success?: false; error?: string }

async function postIngest<T>(path: string, body: Record<string, unknown>): Promise<T | null> {
  if (!ENABLED) return null
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

async function patchIngest(path: string, body: Record<string, unknown>): Promise<void> {
  if (!ENABLED) return
  try {
    await fetch(`${BASE_URL}${path}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(body),
    })
  } catch {
    // Swallow — internal tracing must never escalate to a caller-visible error.
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

export interface InternalTraceHandle {
  /** Chains future span POSTs behind the trace creation INSERT. */
  readonly creationPromise: Promise<string | null>
  startSpan(name: string, opts?: SpanOpts): InternalSpanHandle
  end(opts?: { status?: 'completed' | 'error'; errorMessage?: string; metadata?: Record<string, unknown> }): void
}

export interface InternalSpanHandle {
  readonly creationPromise: Promise<string | null>
  end(opts?: SpanEndOpts): void
}

export interface SpanOpts {
  spanType?: 'llm' | 'tool' | 'retrieval' | 'chain' | 'agent'
  input?: unknown
  metadata?: Record<string, unknown>
}

export interface SpanEndOpts {
  status?: 'completed' | 'error'
  output?: unknown
  errorMessage?: string
  metadata?: Record<string, unknown>
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  costUsd?: number
}

/**
 * Stub handle returned when tracing is disabled or the trace POST
 * fails. Every method is a no-op so call sites don't need to null-check.
 */
function stubTrace(): InternalTraceHandle {
  const nullPromise = Promise.resolve(null)
  return {
    creationPromise: nullPromise,
    startSpan(): InternalSpanHandle {
      return { creationPromise: nullPromise, end() { /* no-op */ } }
    },
    end() { /* no-op */ },
  }
}

/**
 * Start a trace. Returns immediately with a handle whose
 * `creationPromise` resolves to the server-assigned trace id (or null
 * on failure). The caller never awaits us directly.
 *
 * @param name     Short trace name, e.g. "eval_run".
 * @param metadata Free-form tags written on the trace row.
 */
export function startInternalTrace(
  name: string,
  metadata?: Record<string, unknown>,
): InternalTraceHandle {
  if (!ENABLED) return stubTrace()

  const startedAt = new Date().toISOString()
  const creationPromise = (async (): Promise<string | null> => {
    const body: Record<string, unknown> = { name, started_at: startedAt }
    if (metadata) body['metadata'] = metadata
    const result = await postIngest<InternalIngestSuccess | InternalIngestError>(
      '/ingest/traces',
      body,
    )
    if (!result || !('success' in result) || !result.success) return null
    return result.data.id
  })()

  return {
    creationPromise,
    startSpan(spanName, opts) {
      return startSpanImpl(creationPromise, null, spanName, opts)
    },
    end(opts) {
      // Chain the PATCH behind the trace's own creation INSERT so the
      // server can find the row by id. We intentionally do NOT await
      // this in the caller — it runs in the background.
      void (async () => {
        const traceId = await creationPromise
        if (!traceId) return
        const body: Record<string, unknown> = {
          status: opts?.status ?? 'completed',
          ended_at: new Date().toISOString(),
        }
        if (opts?.errorMessage) body['error_message'] = opts.errorMessage
        if (opts?.metadata) body['metadata'] = opts.metadata
        await patchIngest(`/ingest/traces/${traceId}`, body)
      })()
    },
  }
}

/**
 * Internal helper — implements both the trace-level and span-level
 * `startSpan`. Parent id may be null (top-level under the trace) or a
 * promise resolving to another span's id.
 */
function startSpanImpl(
  traceIdPromise: Promise<string | null>,
  parentIdPromise: Promise<string | null> | null,
  name: string,
  opts?: SpanOpts,
): InternalSpanHandle {
  const startedAt = new Date().toISOString()
  const creationPromise = (async (): Promise<string | null> => {
    const traceId = await traceIdPromise
    if (!traceId) return null
    const parentSpanId = parentIdPromise ? await parentIdPromise : null
    const body: Record<string, unknown> = { name, started_at: startedAt }
    if (parentSpanId) body['parent_span_id'] = parentSpanId
    if (opts?.spanType) body['span_type'] = opts.spanType
    if (opts?.input !== undefined) body['input'] = opts.input
    if (opts?.metadata) body['metadata'] = opts.metadata
    const result = await postIngest<InternalIngestSuccess | InternalIngestError>(
      `/ingest/traces/${traceId}/spans`,
      body,
    )
    if (!result || !('success' in result) || !result.success) return null
    return result.data.id
  })()

  return {
    creationPromise,
    end(endOpts) {
      void (async () => {
        const spanId = await creationPromise
        if (!spanId) return
        const body: Record<string, unknown> = {
          status: endOpts?.status ?? 'completed',
          ended_at: new Date().toISOString(),
        }
        if (endOpts?.output !== undefined) body['output'] = endOpts.output
        if (endOpts?.errorMessage) body['error_message'] = endOpts.errorMessage
        if (endOpts?.metadata) body['metadata'] = endOpts.metadata
        if (endOpts?.promptTokens != null) body['prompt_tokens'] = endOpts.promptTokens
        if (endOpts?.completionTokens != null) body['completion_tokens'] = endOpts.completionTokens
        if (endOpts?.totalTokens != null) body['total_tokens'] = endOpts.totalTokens
        if (endOpts?.costUsd != null) body['cost_usd'] = endOpts.costUsd
        await patchIngest(`/ingest/spans/${spanId}`, body)
      })()
    },
  }
}

/**
 * Test helper — re-reads the env vars and re-snapshots the ENABLED
 * flag. Used by `internal-tracing.test.ts` to flip the state without
 * restarting Vitest.
 */
export function _refreshEnabledFlagForTests(): boolean {
  return Boolean(process.env['SPANLENS_INTERNAL_BASE_URL'] && process.env['SPANLENS_INTERNAL_API_KEY'])
}

/**
 * Whether internal tracing is currently active. Mostly for diagnostics
 * and the health endpoint; callers should NOT branch on this — the
 * stub handle is designed to be safe to call unconditionally.
 */
export function internalTracingEnabled(): boolean {
  return ENABLED
}
