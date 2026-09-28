import { calculateCost, type Provider } from '../lib/cost.js'
import { logRequestAsync, type RequestLogData } from '../lib/logger.js'
import { resolveBodyRetention, sanitizeJsonForStorage } from '../lib/body-retention.js'
import { supabaseAdmin } from '../lib/db.js'
import { parseOpenAIStreamChunk, extractOpenAIStreamText, type ServiceTier } from '../parsers/openai.js'
import { parseAnthropicStreamStart, parseAnthropicStreamChunk, extractAnthropicStreamText } from '../parsers/anthropic.js'

type StreamLogBase = Omit<
  RequestLogData,
  | 'promptTokens'
  | 'completionTokens'
  | 'totalTokens'
  | 'cacheReadTokens'
  | 'cacheWriteTokens'
  | 'serviceTier'
  | 'costUsd'
  | 'model'
> & { model: string }

/**
 * Optional context for the streaming-log writers. `truncated` flows through
 * to `requests.truncated` so the dashboard can surface deadline-bound rows.
 * Other fields default sensibly when omitted.
 */
export interface StreamLogContext {
  truncated?: boolean
}

type SpanBodyColumn = 'input' | 'output'

/**
 * Copies one body onto the caller's span, but only while that column is still
 * empty: a value the SDK sent itself always wins over the proxy's copy.
 */
async function injectSpanColumn(
  spanId: string,
  organizationId: string,
  column: SpanBodyColumn,
  value: unknown,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('spans')
    .update({ [column]: value })
    .eq('id', spanId)
    .eq('organization_id', organizationId)
    .is(column, null)
  if (error) throw new Error(error.message)
}

/**
 * Mirrors the prompt and the reconstructed completion onto the span named by
 * `x-span-id`, under the same retention rules as the `requests` row: nothing
 * is copied when the customer opted out of body logging (meta / none) or the
 * call was sampled out (`storeBody` false), and what is copied is masked and
 * capped like the row. Failures are logged and swallowed, since the request
 * row is already written.
 */
async function injectSpanBodies(
  base: StreamLogBase,
  storeBody: boolean,
  bodies: { input: unknown; output: string },
  tag: string,
): Promise<void> {
  if (!base.spanId || !storeBody) return
  const { spanId, organizationId } = base
  if (bodies.input != null) {
    await injectSpanColumn(spanId, organizationId, 'input', sanitizeJsonForStorage(bodies.input)).catch((err) => {
      console.error(`[span-input-inject:${tag}]`, err)
    })
  }
  if (bodies.output) {
    await injectSpanColumn(spanId, organizationId, 'output', sanitizeJsonForStorage(bodies.output)).catch((err) => {
      console.error(`[span-output-inject:${tag}]`, err)
    })
  }
}

/** `messages` from an OpenAI-shaped request body, wrapped the way spans store it. */
function openAISpanInput(requestBody: unknown): unknown {
  const messages = (requestBody as Record<string, unknown> | null)?.['messages']
  return messages ? { messages } : null
}

/**
 * 이미 수집된 SSE 라인 배열에서 usage를 파싱하고 DB에 기록합니다.
 * 프록시 핸들러가 Hono의 stream() 헬퍼로 청크를 클라이언트에 직접 전달하면서,
 * 동시에 모은 lines를 여기로 넘깁니다.
 */

export async function logOpenAIStream(
  lines: string[],
  base: StreamLogBase,
  ctx: StreamLogContext = {},
): Promise<void> {
  let model = base.model
  let promptTokens = 0
  let completionTokens = 0
  let totalTokens = 0
  let cacheReadTokens = 0
  let cacheWriteTokens = 0
  let serviceTier: ServiceTier | undefined

  for (const line of lines) {
    const parsed = parseOpenAIStreamChunk(line)
    if (!parsed) continue
    if (parsed.model) model = parsed.model
    if (parsed.promptTokens) promptTokens = parsed.promptTokens
    if (parsed.completionTokens) completionTokens = parsed.completionTokens
    if (parsed.totalTokens) totalTokens = parsed.totalTokens
    if (parsed.cacheReadTokens) cacheReadTokens = parsed.cacheReadTokens
    if (parsed.cacheWriteTokens) cacheWriteTokens = parsed.cacheWriteTokens
    if (parsed.serviceTier) serviceTier = parsed.serviceTier
  }

  // When the stream is cut before the final usage chunk (deadline at 290s or a
  // client disconnect), OpenAI never sends usage and we capture 0 tokens.
  // calculateCost(0 tokens) returns { totalCost: 0 }, which would persist a
  // misleading cost_usd = $0 that looks like a real zero-cost call. Record null
  // ("unknown") instead — the truncated flag + partial responseBody already
  // mark the row incomplete. Billing is unaffected: quota/overage meter request
  // COUNT, not cost_usd.
  const hasUsage = promptTokens > 0 || completionTokens > 0
  const cost = hasUsage
    ? calculateCost('openai' as Provider, model, {
        promptTokens, completionTokens, cacheReadTokens, cacheWriteTokens, serviceTier,
      })
    : null

  const text = extractOpenAIStreamText(lines)
  // Capture-rate signal: stream completed but no assistant text recovered
  // (lines were present). Usually means the upstream wire format changed or
  // a chunk format slipped past the parser. Surface for log monitoring.
  if (lines.length > 0 && text.length === 0) {
    console.warn(
      '[openai-stream] capture-empty: %d SSE lines, 0 chars extracted (parser drift?)',
      lines.length,
    )
  }
  const responseBody = text ? {
    object: 'chat.completion',
    model,
    choices: [{ message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: totalTokens,
      ...(cacheReadTokens > 0 ? { prompt_tokens_details: { cached_tokens: cacheReadTokens } } : {}),
    },
  } : null

  // One retention decision for both the request row and the span copy.
  const storeBody = await resolveBodyRetention(base.organizationId, base.logBodyMode)
  await logRequestAsync({
    ...base,
    model,
    promptTokens,
    completionTokens,
    totalTokens,
    cacheReadTokens,
    cacheWriteTokens,
    serviceTier: serviceTier ?? null,
    costUsd: cost?.totalCost ?? null,
    responseBody,
    truncated: ctx.truncated ?? false,
    storeBody,
  })

  await injectSpanBodies(base, storeBody, { input: openAISpanInput(base.requestBody), output: text }, 'openai')
}

/**
 * OpenRouter streams use the OpenAI SSE shape, but the final usage chunk
 * also carries an authoritative `usage.cost` field (USD), which our local
 * price table can't replicate because OpenRouter applies per-customer
 * discounts and routes some traffic through cheaper inference providers
 * we don't see. We pre-extract that value here and prefer it over the
 * model-table lookup — same preference order as the non-streaming path
 * in proxy/openrouter.ts. Without this, /requests rows for streamed
 * OpenRouter calls show cost_usd = null.
 */
export async function logOpenRouterStream(
  lines: string[],
  base: StreamLogBase,
  ctx: StreamLogContext = {},
): Promise<void> {
  let model = base.model
  let promptTokens = 0
  let completionTokens = 0
  let totalTokens = 0
  let cacheReadTokens = 0
  let cacheWriteTokens = 0
  let serviceTier: ServiceTier | undefined
  let openrouterReportedCost: number | null = null

  for (const line of lines) {
    // Capture usage.cost before delegating to parseOpenAIStreamChunk, which
    // collapses the chunk into a typed shape that drops unrecognized fields.
    const dataMatch = line.match(/^data:\s*(.+)$/)
    if (dataMatch && dataMatch[1] && dataMatch[1] !== '[DONE]') {
      try {
        const chunk = JSON.parse(dataMatch[1]) as Record<string, unknown>
        const usage = chunk['usage'] as Record<string, unknown> | undefined
        const rawCost = usage?.['cost']
        if (typeof rawCost === 'number' && Number.isFinite(rawCost)) {
          openrouterReportedCost = rawCost
        }
      } catch {
        /* non-JSON line, ignore */
      }
    }
    const parsed = parseOpenAIStreamChunk(line)
    if (!parsed) continue
    if (parsed.model) model = parsed.model
    if (parsed.promptTokens) promptTokens = parsed.promptTokens
    if (parsed.completionTokens) completionTokens = parsed.completionTokens
    if (parsed.totalTokens) totalTokens = parsed.totalTokens
    if (parsed.cacheReadTokens) cacheReadTokens = parsed.cacheReadTokens
    if (parsed.cacheWriteTokens) cacheWriteTokens = parsed.cacheWriteTokens
    if (parsed.serviceTier) serviceTier = parsed.serviceTier
  }

  // Cost preference order matches the non-streaming path in proxy/openrouter.ts:
  //   1. usage.cost from the final SSE chunk (authoritative).
  //   2. local calculator against the FULL model id (our OpenRouter price rows
  //      keep the vendor prefix).
  //   3. the vendor-stripped id, as a last resort.
  //   4. NULL.
  const strippedModel = (() => {
    const idx = model.indexOf('/')
    return idx === -1 ? model : model.slice(idx + 1)
  })()
  let finalCostUsd: number | null = null
  if (openrouterReportedCost !== null) {
    finalCostUsd = openrouterReportedCost
  } else if (promptTokens > 0 || completionTokens > 0) {
    const usage = { promptTokens, completionTokens, cacheReadTokens, cacheWriteTokens, serviceTier }
    const lookup =
      calculateCost('openrouter' as Provider, model, usage) ??
      calculateCost('openrouter' as Provider, strippedModel, usage)
    finalCostUsd = lookup?.totalCost ?? null
  }
  // else: no authoritative usage.cost AND no token usage captured (truncated
  // stream) → leave null rather than a misleading $0. See logOpenAIStream.

  const text = extractOpenAIStreamText(lines)
  if (lines.length > 0 && text.length === 0) {
    console.warn(
      '[openrouter-stream] capture-empty: %d SSE lines, 0 chars extracted (parser drift?)',
      lines.length,
    )
  }
  const responseBody = text ? {
    object: 'chat.completion',
    model,
    choices: [{ message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: totalTokens,
      ...(cacheReadTokens > 0 ? { prompt_tokens_details: { cached_tokens: cacheReadTokens } } : {}),
      ...(openrouterReportedCost !== null ? { cost: openrouterReportedCost } : {}),
    },
  } : null

  // One retention decision for both the request row and the span copy.
  const storeBody = await resolveBodyRetention(base.organizationId, base.logBodyMode)
  await logRequestAsync({
    ...base,
    model,
    promptTokens,
    completionTokens,
    totalTokens,
    cacheReadTokens,
    cacheWriteTokens,
    serviceTier: serviceTier ?? null,
    costUsd: finalCostUsd,
    responseBody,
    truncated: ctx.truncated ?? false,
    storeBody,
  })

  await injectSpanBodies(base, storeBody, { input: openAISpanInput(base.requestBody), output: text }, 'openrouter')
}

export async function logAnthropicStream(
  lines: string[],
  base: StreamLogBase,
  ctx: StreamLogContext = {},
): Promise<void> {
  let model = base.model
  let promptTokens = 0
  let completionTokens = 0
  let cacheReadTokens = 0
  let cacheWriteTokens = 0
  let serviceTier: ServiceTier | undefined

  for (const line of lines) {
    const start = parseAnthropicStreamStart(line)
    if (start) {
      if (start.promptTokens) promptTokens = start.promptTokens
      if (start.cacheReadTokens) cacheReadTokens = start.cacheReadTokens
      if (start.cacheWriteTokens) cacheWriteTokens = start.cacheWriteTokens
      if (start.model) model = start.model
      if (start.serviceTier) serviceTier = start.serviceTier
      continue
    }
    const delta = parseAnthropicStreamChunk(line)
    // Anthropic's message_delta.usage.output_tokens is CUMULATIVE (the running
    // total so far), not a per-delta increment. Assign the latest value rather
    // than summing — today exactly one message_delta arrives, but a future
    // multi-delta stream would double-count with `+=`.
    if (delta?.completionTokens) completionTokens = delta.completionTokens
  }

  const totalTokens = promptTokens + completionTokens
  // Anthropic accumulates completion tokens per-delta and reads prompt tokens at
  // message_start, so it usually has usage even when truncated. Guard anyway for
  // consistency: no usage captured → null cost, not a misleading $0. See
  // logOpenAIStream.
  const hasUsage = promptTokens > 0 || completionTokens > 0
  const cost = hasUsage
    ? calculateCost('anthropic' as Provider, model, {
        promptTokens, completionTokens, cacheReadTokens, cacheWriteTokens, serviceTier,
      })
    : null

  // Reconstruct upstream-shape usage so the dashboard preserves the raw
  // breakdown. Note: promptTokens already includes cache portions, so the raw
  // input_tokens is recovered by subtracting them back out.
  const rawInputTokens = Math.max(0, promptTokens - cacheReadTokens - cacheWriteTokens)
  const text = extractAnthropicStreamText(lines)
  if (lines.length > 0 && text.length === 0) {
    console.warn(
      '[anthropic-stream] capture-empty: %d SSE lines, 0 chars extracted (parser drift?)',
      lines.length,
    )
  }
  const responseBody = text ? {
    type: 'message',
    role: 'assistant',
    model,
    content: [{ type: 'text', text }],
    usage: {
      input_tokens: rawInputTokens,
      output_tokens: completionTokens,
      ...(cacheReadTokens > 0 ? { cache_read_input_tokens: cacheReadTokens } : {}),
      ...(cacheWriteTokens > 0 ? { cache_creation_input_tokens: cacheWriteTokens } : {}),
    },
  } : null

  // One retention decision for both the request row and the span copy.
  const storeBody = await resolveBodyRetention(base.organizationId, base.logBodyMode)
  await logRequestAsync({
    ...base,
    model,
    promptTokens,
    completionTokens,
    totalTokens,
    cacheReadTokens,
    cacheWriteTokens,
    serviceTier: serviceTier ?? null,
    costUsd: cost?.totalCost ?? null,
    responseBody,
    truncated: ctx.truncated ?? false,
    storeBody,
  })

  const reqBody = base.requestBody as Record<string, unknown> | null
  const messages = reqBody?.['messages']
  const system = reqBody?.['system']
  const input = messages ? (system ? { system, messages } : messages) : null
  await injectSpanBodies(base, storeBody, { input, output: text }, 'anthropic')
}
