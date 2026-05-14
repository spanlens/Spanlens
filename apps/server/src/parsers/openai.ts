export interface ParsedUsage {
  /**
   * Total input tokens (INCLUDING any cached portion).
   * For OpenAI this is `usage.prompt_tokens` as-reported.
   * cache_read_tokens is a SUBSET of this number, not an addition.
   */
  promptTokens: number
  completionTokens: number
  totalTokens: number
  model: string
  /**
   * Cached input tokens (subset of promptTokens).
   * OpenAI: `usage.prompt_tokens_details.cached_tokens`.
   * Charged at the reduced cache_read price in lib/cost.ts.
   */
  cacheReadTokens?: number
  /**
   * Cache-creation input tokens (subset of promptTokens).
   * OpenAI: no equivalent in the public API as of 2026-05; always 0/undefined.
   */
  cacheWriteTokens?: number
}

export function parseOpenAIResponse(body: Record<string, unknown>): ParsedUsage | null {
  const usage = body.usage as Record<string, unknown> | undefined
  if (!usage) return null
  const promptDetails = usage.prompt_tokens_details as Record<string, number> | undefined
  const cacheReadTokens = promptDetails?.cached_tokens ?? 0
  return {
    promptTokens: (usage.prompt_tokens as number) ?? 0,
    completionTokens: (usage.completion_tokens as number) ?? 0,
    totalTokens: (usage.total_tokens as number) ?? 0,
    model: (body.model as string) ?? '',
    cacheReadTokens,
    cacheWriteTokens: 0,
  }
}

export function extractOpenAIStreamText(lines: string[]): string {
  const parts: string[] = []
  for (const line of lines) {
    if (!line.startsWith('data: ')) continue
    const data = line.slice(6).trim()
    if (data === '[DONE]') break
    try {
      const json = JSON.parse(data) as Record<string, unknown>
      const choices = json.choices as Array<{ delta?: { content?: string } }> | undefined
      const content = choices?.[0]?.delta?.content
      if (content) parts.push(content)
    } catch { /* ignore */ }
  }
  return parts.join('')
}

export function parseOpenAIStreamChunk(line: string): Partial<ParsedUsage> | null {
  if (!line.startsWith('data: ')) return null
  const data = line.slice(6).trim()
  if (data === '[DONE]') return null
  try {
    const json = JSON.parse(data) as Record<string, unknown>
    const usage = json.usage as Record<string, unknown> | null
    if (!usage) return null
    const promptDetails = usage.prompt_tokens_details as Record<string, number> | undefined
    return {
      promptTokens: (usage.prompt_tokens as number) ?? 0,
      completionTokens: (usage.completion_tokens as number) ?? 0,
      totalTokens: (usage.total_tokens as number) ?? 0,
      model: (json.model as string) ?? '',
      cacheReadTokens: promptDetails?.cached_tokens ?? 0,
      cacheWriteTokens: 0,
    }
  } catch {
    return null
  }
}
