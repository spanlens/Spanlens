import { calculateCost, type Provider } from '../lib/cost.js'
import { logRequestAsync, type RequestLogData } from '../lib/logger.js'
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

async function injectSpanInput(spanId: string, organizationId: string, input: unknown): Promise<void> {
  const { error } = await supabaseAdmin
    .from('spans')
    .update({ input })
    .eq('id', spanId)
    .eq('organization_id', organizationId)
    .is('input', null)
  if (error) throw new Error(error.message)
}

async function injectSpanOutput(spanId: string, organizationId: string, output: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('spans')
    .update({ output })
    .eq('id', spanId)
    .eq('organization_id', organizationId)
    .is('output', null)
  if (error) throw new Error(error.message)
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
  })

  if (base.spanId) {
    const reqBody = base.requestBody as Record<string, unknown> | null
    const messages = reqBody?.messages
    if (messages) {
      await injectSpanInput(base.spanId, base.organizationId, { messages }).catch((err) => {
        console.error('[span-input-inject:openai]', err)
      })
    }
    if (text) {
      await injectSpanOutput(base.spanId, base.organizationId, text).catch((err) => {
        console.error('[span-output-inject:openai]', err)
      })
    }
  }
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
  //   2. local calculator against the vendor-stripped model id.
  //   3. NULL.
  const strippedModel = (() => {
    const idx = model.indexOf('/')
    return idx === -1 ? model : model.slice(idx + 1)
  })()
  let finalCostUsd: number | null = null
  if (openrouterReportedCost !== null) {
    finalCostUsd = openrouterReportedCost
  } else if (promptTokens > 0 || completionTokens > 0) {
    const lookup = calculateCost('openrouter' as Provider, strippedModel, {
      promptTokens, completionTokens, cacheReadTokens, cacheWriteTokens, serviceTier,
    })
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
  })

  if (base.spanId) {
    const reqBody = base.requestBody as Record<string, unknown> | null
    const messages = reqBody?.messages
    if (messages) {
      await injectSpanInput(base.spanId, base.organizationId, { messages }).catch((err) => {
        console.error('[span-input-inject:openrouter]', err)
      })
    }
    if (text) {
      await injectSpanOutput(base.spanId, base.organizationId, text).catch((err) => {
        console.error('[span-output-inject:openrouter]', err)
      })
    }
  }
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
    if (delta?.completionTokens) completionTokens += delta.completionTokens
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
  })

  if (base.spanId) {
    const reqBody = base.requestBody as Record<string, unknown> | null
    const messages = reqBody?.messages
    const system = reqBody?.system
    const input = messages ? (system ? { system, messages } : messages) : null
    if (input) {
      await injectSpanInput(base.spanId, base.organizationId, input).catch((err) => {
        console.error('[span-input-inject:anthropic]', err)
      })
    }
    if (text) {
      await injectSpanOutput(base.spanId, base.organizationId, text).catch((err) => {
        console.error('[span-output-inject:anthropic]', err)
      })
    }
  }
}
