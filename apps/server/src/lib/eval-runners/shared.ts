/**
 * Shared helpers used by both eval runner paths (LLM judge + deterministic).
 *
 * Extracted from lib/eval-runner.ts during the 1273-line split. Kept tiny
 * on purpose — anything that grows here should probably be its own module.
 */

/** Cap on the response text fed into the judge prompt or a regex. */
export const MAX_RESPONSE_CHARS = 4000

/**
 * Truncate text to at most `max` characters while preserving BOTH ends (P1-7).
 *
 * A long LLM response often states its actual answer or conclusion at the very
 * end, so head-only truncation (`slice(0, max)`) can hide the exact thing the
 * judge is scoring. This keeps the first ~60% and last ~40% of the budget with
 * an elision marker in the middle. Short text passes through unchanged so the
 * common case is byte-identical to before.
 */
export function truncateMiddle(text: string, max: number = MAX_RESPONSE_CHARS): string {
  if (text.length <= max) return text
  const marker = '\n…[truncated middle]…\n'
  // Degenerate case: budget too small to keep both ends meaningfully — fall
  // back to a plain head slice so we never return more than `max` chars.
  if (max <= marker.length + 2) return text.slice(0, max)
  const budget = max - marker.length
  const headLen = Math.ceil(budget * 0.6)
  const tailLen = budget - headLen
  return text.slice(0, headLen) + marker + text.slice(text.length - tailLen)
}

/** Retry attempts for LLM / embedding calls (env-tunable). */
export const EVAL_MAX_RETRIES = Number(process.env['EVAL_MAX_RETRIES']) || 3

function evalSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * fetch with exponential backoff on transient failures (429, 5xx, network
 * error). Returns the final Response (which may still be non-ok) or null if
 * every attempt threw. Callers treat a non-ok / null result as a dropped
 * sample, so this only adds resilience — it never changes the success
 * contract. Back-off: 250ms, 500ms, 1000ms (× EVAL_MAX_RETRIES). Shared by
 * the judge path (eval-runner.ts) and the embedding path (embedding.ts).
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  retries: number = EVAL_MAX_RETRIES,
): Promise<Response | null> {
  let last: Response | null = null
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, init)
      if (res.ok || !(res.status === 429 || (res.status >= 500 && res.status < 600))) {
        return res
      }
      last = res
    } catch {
      last = null
    }
    if (attempt < retries) await evalSleep(250 * Math.pow(2, attempt))
  }
  return last
}

/**
 * Extract the assistant response text from a stored response_body. Handles
 * the three provider shapes Spanlens proxies today: OpenAI chat.completion,
 * Anthropic Messages, and Gemini generateContent. Returns null when nothing
 * recognizable is present so callers can skip the sample.
 */
export function extractResponseText(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const obj = body as Record<string, unknown>

  // OpenAI chat completion
  const choices = obj['choices'] as Array<Record<string, unknown>> | undefined
  if (Array.isArray(choices) && choices[0]) {
    const msg = choices[0]['message'] as Record<string, unknown> | undefined
    const content = typeof msg?.['content'] === 'string' ? msg['content'] : null
    if (content) return content as string
  }

  // Anthropic messages
  const content = obj['content'] as Array<Record<string, unknown>> | undefined
  if (Array.isArray(content)) {
    const textBlock = content.find((b) => b['type'] === 'text')
    if (textBlock && typeof textBlock['text'] === 'string') return textBlock['text'] as string
  }

  // Gemini
  const candidates = obj['candidates'] as Array<Record<string, unknown>> | undefined
  if (Array.isArray(candidates) && candidates[0]) {
    const candidate = candidates[0]
    const cContent = candidate['content'] as Record<string, unknown> | undefined
    const parts = cContent?.['parts'] as Array<Record<string, unknown>> | undefined
    if (Array.isArray(parts) && parts[0] && typeof parts[0]['text'] === 'string') {
      return parts[0]['text'] as string
    }
  }

  return null
}
