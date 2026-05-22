/**
 * Provider-reported service tier values we recognize. Stored verbatim in
 * ClickHouse `requests.service_tier` so the dashboard can group by it. The
 * cost calculator maps these to multipliers (see lib/cost.ts).
 *
 *   OpenAI (`response.service_tier`): 'default' | 'auto' | 'flex' | 'priority' | 'scale'
 *   Gemini (`response.usageMetadata.serviceTier`): mirrors the OpenAI names
 *     for the most part; 'default' = Standard, 'flex', 'priority', 'batch'.
 *   Unknown / missing → undefined; caller logs '' (empty string).
 */
export type ServiceTier = 'default' | 'standard' | 'auto' | 'flex' | 'priority' | 'scale' | 'batch'

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
  cacheReadTokens?: number | undefined
  /**
   * Cache-creation input tokens (subset of promptTokens).
   * OpenAI: no equivalent in the public API as of 2026-05; always 0/undefined.
   */
  cacheWriteTokens?: number | undefined
  /**
   * Actual processing tier the provider used to fulfill this request.
   * IMPORTANT: this is the *served* tier, not what the caller requested —
   * OpenAI can downgrade a priority request to 'default' on ramp-rate breach,
   * and that downgrade shows up here. Always trust this over request params.
   *
   * `| undefined` is explicit because the repo uses
   * `exactOptionalPropertyTypes: true` — a bare `?:` would forbid assigning
   * `undefined`, only allow omission of the property entirely.
   */
  serviceTier?: ServiceTier | undefined
}

const KNOWN_TIERS: ReadonlySet<ServiceTier> = new Set([
  'default', 'standard', 'auto', 'flex', 'priority', 'scale', 'batch',
])

/** Narrow an unknown string to ServiceTier, dropping anything we don't recognize. */
function coerceServiceTier(value: unknown): ServiceTier | undefined {
  if (typeof value !== 'string') return undefined
  return KNOWN_TIERS.has(value as ServiceTier) ? (value as ServiceTier) : undefined
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
    serviceTier: coerceServiceTier(body.service_tier),
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
      serviceTier: coerceServiceTier(json.service_tier),
    }
  } catch {
    return null
  }
}
