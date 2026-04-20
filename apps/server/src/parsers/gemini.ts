import type { ParsedUsage } from './openai.js'

export function parseGeminiResponse(body: Record<string, unknown>): ParsedUsage | null {
  const meta = body.usageMetadata as Record<string, number> | undefined
  if (!meta) return null
  return {
    promptTokens: meta.promptTokenCount ?? 0,
    completionTokens: meta.candidatesTokenCount ?? 0,
    totalTokens: meta.totalTokenCount ?? 0,
    model: (body.modelVersion as string) ?? '',
  }
}
