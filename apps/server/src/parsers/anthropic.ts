import type { ParsedUsage } from './openai.js'

/**
 * Anthropic 응답에서 usage를 추출합니다.
 *
 * Anthropic은 `input_tokens` 필드가 NON-CACHED 입력만 카운트하고,
 * 캐시 부분은 별도로 `cache_read_input_tokens` / `cache_creation_input_tokens`로 보고합니다.
 * Spanlens는 `promptTokens` 컬럼을 "총 input tokens (캐시 포함)" 의미로 유지하므로,
 * 세 필드를 합산해서 promptTokens에 넣고, 캐시 부분은 별도 필드로도 노출합니다.
 *
 * (참고: streaming은 message_start에서 input_tokens + cache_*가 함께 옴 — 동일하게 합산)
 */
function buildAnthropicUsage(usage: Record<string, number>, model: string): ParsedUsage {
  const inputTokens = usage.input_tokens ?? 0
  const cacheRead = usage.cache_read_input_tokens ?? 0
  const cacheWrite = usage.cache_creation_input_tokens ?? 0
  const promptTokens = inputTokens + cacheRead + cacheWrite
  const completionTokens = usage.output_tokens ?? 0
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    model,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
  }
}

export function parseAnthropicResponse(body: Record<string, unknown>): ParsedUsage | null {
  const usage = body.usage as Record<string, number> | undefined
  if (!usage) return null
  return buildAnthropicUsage(usage, (body.model as string) ?? '')
}

export function extractAnthropicStreamText(lines: string[]): string {
  const parts: string[] = []
  for (const line of lines) {
    if (!line.startsWith('data: ')) continue
    const data = line.slice(6).trim()
    try {
      const json = JSON.parse(data) as Record<string, unknown>
      if (json.type === 'content_block_delta') {
        const delta = json.delta as { type?: string; text?: string } | undefined
        if (delta?.type === 'text_delta' && delta.text) parts.push(delta.text)
      }
    } catch { /* ignore */ }
  }
  return parts.join('')
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
    const inputTokens = usage.input_tokens ?? 0
    const cacheRead = usage.cache_read_input_tokens ?? 0
    const cacheWrite = usage.cache_creation_input_tokens ?? 0
    return {
      promptTokens: inputTokens + cacheRead + cacheWrite,
      cacheReadTokens: cacheRead,
      cacheWriteTokens: cacheWrite,
      model: (message?.model as string) ?? '',
    }
  } catch {
    return null
  }
}
