/**
 * Response parsers for major LLM providers — extract usage/cost metadata from
 * a provider response and produce the shape expected by `SpanHandle.end()`.
 *
 * These are structural parsers: they tolerate missing fields (streaming, tool
 * calls, errors) and return partials that `span.end(...)` accepts as-is.
 */

import type { EndSpanOptions } from './types.js'

// ── OpenAI (chat.completions / responses / embeddings) ───────

interface OpenAIUsage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  input_tokens?: number  // responses API
  output_tokens?: number
}

interface OpenAIResponse {
  model?: string
  usage?: OpenAIUsage
}

/**
 * Parse an OpenAI response and return the token/model bits that `span.end()`
 * accepts. Handles both `chat.completions` (prompt/completion_tokens) and the
 * newer `responses` API (input/output_tokens).
 */
export function parseOpenAIUsage(res: unknown): EndSpanOptions {
  if (!res || typeof res !== 'object') return {}
  const typed = res as OpenAIResponse
  const u = typed.usage
  if (!u) return {}

  const promptTokens = u.prompt_tokens ?? u.input_tokens ?? 0
  const completionTokens = u.completion_tokens ?? u.output_tokens ?? 0
  const totalTokens = u.total_tokens ?? promptTokens + completionTokens

  const out: EndSpanOptions = { promptTokens, completionTokens, totalTokens }
  if (typed.model) {
    out.metadata = { model: typed.model }
  }
  return out
}

// ── Anthropic messages ────────────────────────────────────────

interface AnthropicUsage {
  input_tokens?: number
  output_tokens?: number
}

interface AnthropicResponse {
  model?: string
  usage?: AnthropicUsage
}

export function parseAnthropicUsage(res: unknown): EndSpanOptions {
  if (!res || typeof res !== 'object') return {}
  const typed = res as AnthropicResponse
  const u = typed.usage
  if (!u) return {}

  const promptTokens = u.input_tokens ?? 0
  const completionTokens = u.output_tokens ?? 0
  const totalTokens = promptTokens + completionTokens

  const out: EndSpanOptions = { promptTokens, completionTokens, totalTokens }
  if (typed.model) {
    out.metadata = { model: typed.model }
  }
  return out
}

// ── Google Gemini (generateContent) ──────────────────────────

interface GeminiUsageMetadata {
  promptTokenCount?: number
  candidatesTokenCount?: number
  totalTokenCount?: number
}

interface GeminiResponse {
  modelVersion?: string
  usageMetadata?: GeminiUsageMetadata
}

export function parseGeminiUsage(res: unknown): EndSpanOptions {
  if (!res || typeof res !== 'object') return {}
  const typed = res as GeminiResponse
  const u = typed.usageMetadata
  if (!u) return {}

  const promptTokens = u.promptTokenCount ?? 0
  const completionTokens = u.candidatesTokenCount ?? 0
  const totalTokens = u.totalTokenCount ?? promptTokens + completionTokens

  const out: EndSpanOptions = { promptTokens, completionTokens, totalTokens }
  if (typed.modelVersion) {
    out.metadata = { model: typed.modelVersion }
  }
  return out
}
