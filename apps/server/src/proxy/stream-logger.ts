import { calculateCost, type Provider } from '../lib/cost.js'
import { logRequestAsync, type RequestLogData } from '../lib/logger.js'
import { supabaseAdmin } from '../lib/db.js'
import { parseOpenAIStreamChunk, extractOpenAIStreamText } from '../parsers/openai.js'
import { parseAnthropicStreamStart, parseAnthropicStreamChunk, extractAnthropicStreamText } from '../parsers/anthropic.js'

type StreamLogBase = Omit<
  RequestLogData,
  'promptTokens' | 'completionTokens' | 'totalTokens' | 'costUsd' | 'model'
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

  for (const line of lines) {
    const parsed = parseOpenAIStreamChunk(line)
    if (!parsed) continue
    if (parsed.model) model = parsed.model
    if (parsed.promptTokens) promptTokens = parsed.promptTokens
    if (parsed.completionTokens) completionTokens = parsed.completionTokens
    if (parsed.totalTokens) totalTokens = parsed.totalTokens
  }

  const cost = calculateCost('openai' as Provider, model, { promptTokens, completionTokens })

  const text = extractOpenAIStreamText(lines)
  const responseBody = text ? {
    object: 'chat.completion',
    model,
    choices: [{ message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
    usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: totalTokens },
  } : null

  await logRequestAsync({
    ...base,
    model,
    promptTokens,
    completionTokens,
    totalTokens,
    costUsd: cost?.totalCost ?? null,
    responseBody,
  })

  if (base.spanId) {
    const reqBody = base.requestBody as Record<string, unknown> | null
    const input = reqBody?.messages
    if (input) {
      await injectSpanInput(base.spanId, base.organizationId, input).catch((err) => {
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

  for (const line of lines) {
    const start = parseAnthropicStreamStart(line)
    if (start) {
      if (start.promptTokens) promptTokens = start.promptTokens
      if (start.model) model = start.model
      continue
    }
    const delta = parseAnthropicStreamChunk(line)
    if (delta?.completionTokens) completionTokens += delta.completionTokens
  }

  const totalTokens = promptTokens + completionTokens
  const cost = calculateCost('anthropic' as Provider, model, { promptTokens, completionTokens })

  const text = extractAnthropicStreamText(lines)
  const responseBody = text ? {
    type: 'message',
    role: 'assistant',
    model,
    content: [{ type: 'text', text }],
    usage: { input_tokens: promptTokens, output_tokens: completionTokens },
  } : null

  await logRequestAsync({
    ...base,
    model,
    promptTokens,
    completionTokens,
    totalTokens,
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
