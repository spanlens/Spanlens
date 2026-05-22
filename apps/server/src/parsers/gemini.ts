import type { ParsedUsage, ServiceTier } from './openai.js'

const KNOWN_TIERS: ReadonlySet<ServiceTier> = new Set([
  'default', 'auto', 'flex', 'priority', 'scale', 'batch',
])

/**
 * Gemini's enum names mostly match OpenAI but the docs aren't fully
 * normalized — some snapshots use 'GENERATE_CONTENT_PROCESSING_TIER_DEFAULT'
 * style constants. We accept short and SCREAMING_SNAKE forms.
 */
function coerceGeminiTier(value: unknown): ServiceTier | undefined {
  if (typeof value !== 'string' || value === '') return undefined
  const lower = value.toLowerCase()
  // SCREAMING_SNAKE_CASE → suffix lookup ("..._FLEX" → "flex")
  const tail = lower.split('_').pop() ?? lower
  if (KNOWN_TIERS.has(tail as ServiceTier)) return tail as ServiceTier
  if (KNOWN_TIERS.has(lower as ServiceTier)) return lower as ServiceTier
  return undefined
}

export function parseGeminiResponse(body: Record<string, unknown>): ParsedUsage | null {
  const meta = body.usageMetadata as Record<string, unknown> | undefined
  if (!meta) return null
  return {
    promptTokens: (meta.promptTokenCount as number) ?? 0,
    completionTokens: (meta.candidatesTokenCount as number) ?? 0,
    totalTokens: (meta.totalTokenCount as number) ?? 0,
    model: (body.modelVersion as string) ?? '',
    serviceTier: coerceGeminiTier(meta.serviceTier),
  }
}

/**
 * Reconstruct the assistant-visible text from a Gemini streaming response.
 *
 * Gemini's :streamGenerateContent endpoint can emit chunks in two formats:
 *   1. With `?alt=sse` — SSE lines starting with "data: ".
 *   2. Default — a single JSON ARRAY of partial GenerateContentResponse objects,
 *      streamed character-by-character. We accept the joined buffer and parse
 *      defensively.
 *
 * Returns the joined text from `candidates[0].content.parts[*].text`. Empty
 * string on parse failure — callers should treat empty + non-empty input as
 * a parser regression signal.
 */
export function extractGeminiStreamText(linesOrBuffer: string[] | string): string {
  const lines = Array.isArray(linesOrBuffer)
    ? linesOrBuffer
    : linesOrBuffer.split('\n')

  const parts: string[] = []

  // Try SSE form first ("data: {json}")
  let sawSseData = false
  for (const line of lines) {
    if (!line.startsWith('data: ')) continue
    sawSseData = true
    const data = line.slice(6).trim()
    if (!data || data === '[DONE]') continue
    appendTextFromGeminiChunk(data, parts)
  }
  if (sawSseData) return parts.join('')

  // Fallback: try to parse the whole thing as a JSON array (default Gemini stream format)
  const joined = lines.join('\n').trim()
  if (joined.startsWith('[')) {
    try {
      const arr = JSON.parse(joined) as unknown[]
      for (const item of arr) {
        if (typeof item === 'object' && item !== null) {
          appendTextFromGeminiChunk(JSON.stringify(item), parts)
        }
      }
    } catch {
      // Stream may be aborted mid-array — fall through to line-by-line scan
    }
  }

  // Last resort: scan each line as standalone JSON (NDJSON-like).
  // Lines from a truncated array carry framing characters (leading "[" or ","
  // and trailing "," or "]") that need to be stripped before JSON.parse.
  if (parts.length === 0) {
    for (const line of lines) {
      const trimmed = line
        .trim()
        .replace(/^[[,\s]+/, '')
        .replace(/[\],\s]+$/, '')
      if (!trimmed || !trimmed.startsWith('{')) continue
      appendTextFromGeminiChunk(trimmed, parts)
    }
  }

  return parts.join('')
}

function appendTextFromGeminiChunk(data: string, sink: string[]): void {
  try {
    const json = JSON.parse(data) as Record<string, unknown>
    const candidates = json.candidates as Array<{
      content?: { parts?: Array<{ text?: string }> }
    }> | undefined
    const partsArr = candidates?.[0]?.content?.parts
    if (!partsArr) return
    for (const p of partsArr) {
      if (p.text) sink.push(p.text)
    }
  } catch {
    // ignore — non-JSON or partial chunk
  }
}
