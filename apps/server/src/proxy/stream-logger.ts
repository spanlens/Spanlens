import { calculateCost, type Provider } from '../lib/cost.js'
import { logRequestAsync, type RequestLogData } from '../lib/logger.js'
import { parseOpenAIStreamChunk } from '../parsers/openai.js'
import { parseAnthropicStreamStart, parseAnthropicStreamChunk } from '../parsers/anthropic.js'

type StreamLogBase = Omit<
  RequestLogData,
  'promptTokens' | 'completionTokens' | 'totalTokens' | 'costUsd' | 'model'
> & { model: string }

async function readStreamLines(stream: ReadableStream<Uint8Array>): Promise<string[]> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  const lines: string[] = []
  let buffer = ''

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const parts = buffer.split('\n')
      buffer = parts.pop() ?? ''

      let sawTerminator = false
      for (const line of parts) {
        lines.push(line)
        // OpenAI: "data: [DONE]" / Anthropic: "message_stop" event
        // 이후에는 done:true를 기다리지 않고 즉시 중단 — Vercel 함수 타임아웃 방지
        if (line === 'data: [DONE]' || line.includes('"message_stop"')) {
          sawTerminator = true
          break
        }
      }
      if (sawTerminator) break
    }
    if (buffer.length > 0) lines.push(buffer)
  } finally {
    // releaseLock 대신 cancel — 업스트림 스트림에 명시적으로 종료 신호를 보냄
    await reader.cancel().catch(() => undefined)
  }
  return lines
}

export async function logOpenAIStream(
  stream: ReadableStream<Uint8Array>,
  base: StreamLogBase,
): Promise<void> {
  const lines = await readStreamLines(stream)

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

  await logRequestAsync({
    ...base,
    model,
    promptTokens,
    completionTokens,
    totalTokens,
    costUsd: cost?.totalCost ?? null,
  })
}

export async function logAnthropicStream(
  stream: ReadableStream<Uint8Array>,
  base: StreamLogBase,
): Promise<void> {
  const lines = await readStreamLines(stream)

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

  await logRequestAsync({
    ...base,
    model,
    promptTokens,
    completionTokens,
    totalTokens,
    costUsd: cost?.totalCost ?? null,
  })
}
