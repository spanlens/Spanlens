import type { ParsedUsage } from './openai.js'

// Anthropic streaming: usage is in the message_delta event, NOT the last data chunk.
export function parseAnthropicResponse(body: Record<string, unknown>): ParsedUsage | null {
  const usage = body.usage as Record<string, number> | undefined
  if (!usage) return null
  return {
    promptTokens: usage.input_tokens ?? 0,
    completionTokens: usage.output_tokens ?? 0,
    totalTokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
    model: (body.model as string) ?? '',
  }
}

export function parseAnthropicStreamChunk(line: string): Partial<ParsedUsage> | null {
  if (!line.startsWith('data: ')) return null
  const data = line.slice(6).trim()
  try {
    const json = JSON.parse(data) as Record<string, unknown>
    // usage lives inside message_delta event
    if (json.type !== 'message_delta') return null
    const usage = json.usage as Record<string, number> | undefined
    if (!usage) return null
    return {
      completionTokens: usage.output_tokens ?? 0,
    }
  } catch {
    return null
  }
}

export function parseAnthropicStreamStart(line: string): Partial<ParsedUsage> | null {
  if (!line.startsWith('data: ')) return null
  const data = line.slice(6).trim()
  try {
    const json = JSON.parse(data) as Record<string, unknown>
    if (json.type !== 'message_start') return null
    const message = json.message as Record<string, unknown> | undefined
    const usage = message?.usage as Record<string, number> | undefined
    if (!usage) return null
    return {
      promptTokens: usage.input_tokens ?? 0,
      model: (message?.model as string) ?? '',
    }
  } catch {
    return null
  }
}
