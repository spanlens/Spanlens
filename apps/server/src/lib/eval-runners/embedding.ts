/**
 * Embedding-similarity evaluator (P2-12).
 *
 * Scores how semantically close a response is to a reference answer via the
 * cosine similarity of their embeddings — a 0..1 NUMERIC score. It works on
 * both eval sources because it only needs a (response, reference) pair:
 *   - production: reference = config.reference_text (one ideal answer)
 *   - dataset:    reference = the item's expected_output (golden set),
 *                 falling back to config.reference_text
 *
 * The (response, reference) pairing + sample gathering live in
 * runEvalRun; this module is the pure-ish scorer (embed + cosine).
 */

import { calculateCost } from '../cost.js'
import { fetchWithRetry, MAX_RESPONSE_CHARS } from './shared.js'

/** OpenAI-compatible providers share one /embeddings shape; gemini differs;
 * anthropic has no embeddings API (rejected at config validation). */
export type EmbeddingProvider = 'openai' | 'azure' | 'mistral' | 'openrouter' | 'gemini'

export const EMBEDDING_PROVIDERS: EmbeddingProvider[] = ['openai', 'azure', 'mistral', 'openrouter', 'gemini']

export interface EmbeddingConfig {
  provider: EmbeddingProvider
  model: string
  /** Reference text to compare each response against. Required for the
   * production source; for dataset items the item's expected_output wins. */
  reference_text?: string | null
  /** When set, value_boolean = similarity >= threshold (0..1). */
  threshold?: number | null
}

/** Structurally identical to JudgeOutcome so the scoring loop is uniform. */
export interface EmbeddingOutcome {
  score: number
  value_number: number
  value_string: null
  value_boolean: boolean | null
  /** P3-15 mirror — embeddings have no separate "raw" scale (cosine similarity
   *  is already in 0..1 and the same as `value_number`), so this stays null. */
  value_raw_number: null
  reasoning: string
  cost: number
  tokens: number
  /** P3-18 mirror — embedding scoring is deterministic and cheap so we don't
   *  cache it. These stay false/0 to keep the SampleOutcome union uniform. */
  cached: boolean
  cached_savings_usd: number
}

/** Cosine similarity of two equal-length vectors; 0 for degenerate input. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!
    const y = b[i]!
    dot += x * y
    normA += x * x
    normB += y * y
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

/**
 * Embed an array of texts. Returns parallel embeddings + token usage, or null
 * on any failure (caller drops the sample). OpenAI-compatible providers share
 * one request/response shape; gemini uses batchEmbedContents.
 */
async function embedTexts(
  provider: EmbeddingProvider,
  model: string,
  apiKey: string,
  resourceUrl: string | null,
  texts: string[],
): Promise<{ embeddings: number[][]; tokens: number } | null> {
  if (provider === 'gemini') {
    const res = await fetchWithRetry(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:batchEmbedContents?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: texts.map((t) => ({ model: `models/${model}`, content: { parts: [{ text: t }] } })),
        }),
      },
    )
    if (!res || !res.ok) return null
    const json = (await res.json()) as { embeddings?: Array<{ values?: number[] }> }
    const embeddings = (json.embeddings ?? []).map((e) => e.values ?? [])
    if (embeddings.length !== texts.length || embeddings.some((e) => e.length === 0)) return null
    // Gemini batchEmbedContents does not return token usage.
    return { embeddings, tokens: 0 }
  }

  // OpenAI-compatible: openai / azure / mistral / openrouter.
  let url: string
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (provider === 'azure') {
    if (!resourceUrl) return null
    url = `${resourceUrl}/openai/v1/embeddings`
    headers['api-key'] = apiKey
  } else {
    const base =
      provider === 'mistral'
        ? 'https://api.mistral.ai/v1'
        : provider === 'openrouter'
          ? 'https://openrouter.ai/api/v1'
          : 'https://api.openai.com/v1'
    url = `${base}/embeddings`
    headers['Authorization'] = `Bearer ${apiKey}`
  }

  const res = await fetchWithRetry(url, { method: 'POST', headers, body: JSON.stringify({ model, input: texts }) })
  if (!res || !res.ok) return null
  const json = (await res.json()) as {
    data?: Array<{ embedding?: number[] }>
    usage?: { prompt_tokens?: number; total_tokens?: number }
  }
  const embeddings = (json.data ?? []).map((d) => d.embedding ?? [])
  if (embeddings.length !== texts.length || embeddings.some((e) => e.length === 0)) return null
  return { embeddings, tokens: json.usage?.total_tokens ?? json.usage?.prompt_tokens ?? 0 }
}

/**
 * Score one sample: cosine similarity between the response and the reference.
 * Returns null on embedding failure so the caller drops the sample.
 */
export async function scoreEmbedding(
  config: EmbeddingConfig,
  responseText: string,
  reference: string,
  apiKey: string,
  resourceUrl: string | null,
): Promise<EmbeddingOutcome | null> {
  // Truncate both sides to the same cap as the judge prompt — embedding models
  // have their own token limits and the tail rarely changes the similarity.
  const a = responseText.length > MAX_RESPONSE_CHARS ? responseText.slice(0, MAX_RESPONSE_CHARS) : responseText
  const b = reference.length > MAX_RESPONSE_CHARS ? reference.slice(0, MAX_RESPONSE_CHARS) : reference

  const result = await embedTexts(config.provider, config.model, apiKey, resourceUrl, [a, b])
  if (!result || result.embeddings.length !== 2) return null

  const sim = cosineSimilarity(result.embeddings[0]!, result.embeddings[1]!)
  const score = Math.max(0, Math.min(1, sim))
  // Azure bills embeddings at OpenAI prices (same as the chat path).
  const costProvider = config.provider === 'azure' ? 'openai' : config.provider
  const cost = calculateCost(costProvider, config.model, { promptTokens: result.tokens, completionTokens: 0 })?.totalCost ?? 0
  const threshold = typeof config.threshold === 'number' ? config.threshold : null

  return {
    score,
    value_number: score,
    value_string: null,
    value_boolean: threshold != null ? score >= threshold : null,
    value_raw_number: null,
    reasoning: `cosine similarity ${score.toFixed(4)}${threshold != null ? ` (threshold ${threshold})` : ''}`,
    cost,
    tokens: result.tokens,
    cached: false,
    cached_savings_usd: 0,
  }
}
