/**
 * Provider-reported service tier values we recognize. Stored verbatim in
 * `requests.service_tier` so the dashboard can group by it. The
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
   * For OpenAI this is `usage.prompt_tokens` (Chat Completions) or
   * `usage.input_tokens` (Responses API) as-reported.
   * cache_read_tokens is a SUBSET of this number, not an addition.
   */
  promptTokens: number
  completionTokens: number
  totalTokens: number
  model: string
  /**
   * Cached input tokens (subset of promptTokens).
   * OpenAI: `usage.prompt_tokens_details.cached_tokens`, or
   * `usage.input_tokens_details.cached_tokens` on the Responses API.
   * Gemini: `usageMetadata.cachedContentTokenCount`.
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

/**
 * Which `usage` schema an OpenAI endpoint returns.
 *
 *   'chat'      Chat Completions (and embeddings / legacy completions):
 *               `prompt_tokens` / `completion_tokens` / `total_tokens`, with
 *               the cached subset at `prompt_tokens_details.cached_tokens`.
 *   'responses' Responses API (`POST /v1/responses`): `input_tokens` /
 *               `output_tokens` / `total_tokens`, with the cached subset at
 *               `input_tokens_details.cached_tokens`. `output_tokens` already
 *               includes `output_tokens_details.reasoning_tokens`, just as
 *               `completion_tokens` does on Chat Completions.
 */
export type OpenAIUsageSchema = 'chat' | 'responses'

/**
 * Pick the usage schema from the endpoint path. Only the Responses CREATE call
 * (`/v1/responses`) uses the Responses schema. Retrieving a stored response
 * (`GET /v1/responses/{id}`) maps to 'chat' on purpose: the create call already
 * recorded that spend, so reading it again would double-count it. Its
 * Responses-shaped usage then reads as unknown (see isOpenAIUsageUnknown).
 */
export function openAIUsageSchemaForPath(path: string): OpenAIUsageSchema {
  return /\/responses\/?$/.test(path) ? 'responses' : 'chat'
}

type JsonRecord = Record<string, unknown>

function asRecord(value: unknown): JsonRecord | undefined {
  return typeof value === 'object' && value !== null ? (value as JsonRecord) : undefined
}

function tokenCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

const USAGE_FIELDS: Record<OpenAIUsageSchema, { input: string; output: string; details: string }> = {
  chat: { input: 'prompt_tokens', output: 'completion_tokens', details: 'prompt_tokens_details' },
  responses: { input: 'input_tokens', output: 'output_tokens', details: 'input_tokens_details' },
}

/**
 * Normalize one `usage` object. Returns null when neither of the schema's
 * token fields is present: usage we cannot read must surface as unknown
 * (cost null), never as zero tokens, which would log a misleading $0 row.
 */
function readUsage(
  usage: JsonRecord,
  schema: OpenAIUsageSchema,
  model: string,
  serviceTier: unknown,
): ParsedUsage | null {
  const fields = USAGE_FIELDS[schema]
  if (typeof usage[fields.input] !== 'number' && typeof usage[fields.output] !== 'number') {
    return null
  }
  return {
    promptTokens: tokenCount(usage[fields.input]),
    completionTokens: tokenCount(usage[fields.output]),
    totalTokens: tokenCount(usage.total_tokens),
    model,
    cacheReadTokens: tokenCount(asRecord(usage[fields.details])?.cached_tokens),
    cacheWriteTokens: 0,
    serviceTier: coerceServiceTier(serviceTier),
  }
}

export function parseOpenAIResponse(
  body: JsonRecord,
  schema: OpenAIUsageSchema = 'chat',
): ParsedUsage | null {
  const usage = asRecord(body.usage)
  if (!usage) return null
  return readUsage(usage, schema, (body.model as string) ?? '', body.service_tier)
}

/**
 * True when a successful response's cost cannot be known from its body, so
 * the caller records cost_usd as null instead of pricing zero tokens as $0:
 *   - a `usage` object is present but the schema's token fields are missing, or
 *   - a Responses create call has no usage yet (background mode answers
 *     `usage: null` while the response is still queued).
 * Chat-style bodies with no usage at all (moderations, model lists, files)
 * return false and keep their previous zero-token handling.
 */
export function isOpenAIUsageUnknown(body: JsonRecord, schema: OpenAIUsageSchema): boolean {
  if (parseOpenAIResponse(body, schema)) return false
  return schema === 'responses' || asRecord(body.usage) !== undefined
}

/**
 * Terminal Responses API stream events. Each carries the full response object
 * with its final `usage`; the earlier `response.created` / `response.in_progress`
 * events carry `usage: null`. An incomplete response (max_output_tokens reached)
 * is still billed for what it produced, so it counts too.
 */
const RESPONSES_TERMINAL_EVENTS: ReadonlySet<string> = new Set([
  'response.completed',
  'response.incomplete',
  'response.failed',
])

export function extractOpenAIStreamText(lines: string[]): string {
  const parts: string[] = []
  for (const line of lines) {
    if (!line.startsWith('data: ')) continue
    const data = line.slice(6).trim()
    if (data === '[DONE]') break
    try {
      const json = JSON.parse(data) as JsonRecord
      // Responses API streams carry text as `response.output_text.delta` events.
      if (json.type === 'response.output_text.delta') {
        if (typeof json.delta === 'string' && json.delta) parts.push(json.delta)
        continue
      }
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
    const json = JSON.parse(data) as JsonRecord
    // Responses API: usage is nested in the response object of the terminal
    // event. The `type` field names the protocol, so no path hint is needed.
    if (typeof json.type === 'string' && RESPONSES_TERMINAL_EVENTS.has(json.type)) {
      const response = asRecord(json.response)
      const usage = asRecord(response?.usage)
      if (!response || !usage) return null
      return readUsage(usage, 'responses', (response.model as string) ?? '', response.service_tier)
    }
    const usage = asRecord(json.usage)
    if (!usage) return null
    return readUsage(usage, 'chat', (json.model as string) ?? '', json.service_tier)
  } catch {
    return null
  }
}
