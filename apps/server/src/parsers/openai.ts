export interface ParsedUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  model: string
}

export function parseOpenAIResponse(body: Record<string, unknown>): ParsedUsage | null {
  const usage = body.usage as Record<string, number> | undefined
  if (!usage) return null
  return {
    promptTokens: usage.prompt_tokens ?? 0,
    completionTokens: usage.completion_tokens ?? 0,
    totalTokens: usage.total_tokens ?? 0,
    model: (body.model as string) ?? '',
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
    const usage = json.usage as Record<string, number> | null
    if (!usage) return null
    return {
      promptTokens: usage.prompt_tokens ?? 0,
      completionTokens: usage.completion_tokens ?? 0,
      totalTokens: usage.total_tokens ?? 0,
      model: (json.model as string) ?? '',
    }
  } catch {
    return null
  }
}
