import { calculateCost, type Provider } from '../lib/cost.js'
import { logRequestAsync, type RequestLogData } from '../lib/logger.js'
import { supabaseAdmin } from '../lib/db.js'
import { parseOpenAIStreamChunk, extractOpenAIStreamText } from '../parsers/openai.js'
import { parseAnthropicStreamStart, parseAnthropicStreamChunk, extractAnthropicStreamText } from '../parsers/anthropic.js'

type StreamLogBase = Omit<
  RequestLogData,
  | 'promptTokens'
  | 'completionTokens'
  | 'totalTokens'
  | 'cacheReadTokens'
  | 'cacheWriteTokens'
  | 'costUsd'
  | 'model'
> & { model: string }

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
): Promise<void> {
  let model = base.model
  let promptTokens = 0
  let completionTokens = 0
  let totalTokens = 0
  let cacheReadTokens = 0
  let cacheWriteTokens = 0

  for (const line of lines) {
    const parsed = parseOpenAIStreamChunk(line)
    if (!parsed) continue
    if (parsed.model) model = parsed.model
    if (parsed.promptTokens) promptTokens = parsed.promptTokens
    if (parsed.completionTokens) completionTokens = parsed.completionTokens
    if (parsed.totalTokens) totalTokens = parsed.totalTokens
    if (parsed.cacheReadTokens) cacheReadTokens = parsed.cacheReadTokens
    if (parsed.cacheWriteTokens) cacheWriteTokens = parsed.cacheWriteTokens
  }

  const cost = calculateCost('openai' as Provider, model, {
    promptTokens, completionTokens, cacheReadTokens, cacheWriteTokens,
  })

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
    costUsd: cost?.totalCost ?? null,
    responseBody,
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

export async function logAnthropicStream(
  lines: string[],
  base: StreamLogBase,
): Promise<void> {
  let model = base.model
  let promptTokens = 0
  let completionTokens = 0
  let cacheReadTokens = 0
  let cacheWriteTokens = 0

  for (const line of lines) {
    const start = parseAnthropicStreamStart(line)
    if (start) {
      if (start.promptTokens) promptTokens = start.promptTokens
      if (start.cacheReadTokens) cacheReadTokens = start.cacheReadTokens
      if (start.cacheWriteTokens) cacheWriteTokens = start.cacheWriteTokens
      if (start.model) model = start.model
      continue
    }
    const delta = parseAnthropicStreamChunk(line)
    if (delta?.completionTokens) completionTokens += delta.completionTokens
  }

  const totalTokens = promptTokens + completionTokens
  const cost = calculateCost('anthropic' as Provider, model, {
    promptTokens, completionTokens, cacheReadTokens, cacheWriteTokens,
  })

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
    costUsd: cost?.totalCost ?? null,
    responseBody,
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
