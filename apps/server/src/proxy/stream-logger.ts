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
      lines.push(...parts)
    }
    if (buffer.length > 0) lines.push(buffer)
  } finally {
    reader.releaseLock()
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
