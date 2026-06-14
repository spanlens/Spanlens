/**
 * LLM-as-judge prompt construction + reply parsing.
 *
 * Extracted from lib/eval-runner.ts during the 1273-line split. These two
 * functions are the pure, side-effect-free core of the judge path: they
 * don't fetch, don't call upstream, don't write DB. Everything else in
 * the judge path is the imperative shell around them.
 *
 * Why types live here too: buildJudgePrompt and parseJudgeReply both need
 * to know the JudgeConfig (criterion + scale + score_config). Keeping
 * TypedScoreConfig + JudgeConfig in the same file lets the LLM judge
 * runner import a single module instead of two.
 */

import { MAX_RESPONSE_CHARS } from './shared.js'

/**
 * Minimal projection of the score_configs row that the runner actually
 * needs. Mirrors the shape used by `lib/score-validation.ts` so we can
 * share the validator without re-fetching.
 */
export interface TypedScoreConfig {
  id: string
  data_type: 'NUMERIC' | 'CATEGORICAL' | 'BOOLEAN' | 'TEXT'
  min_value: number | null
  max_value: number | null
  categories: unknown
  bool_true_label: string | null
  bool_false_label: string | null
}

export interface JudgeConfig {
  criterion: string
  judge_provider: 'openai' | 'anthropic' | 'gemini' | 'azure' | 'mistral' | 'openrouter'
  judge_model: string
  scale_min: number
  scale_max: number
  // 4B.1c — optional pointer at a workspace score_config. When NULL we
  // preserve the legacy NUMERIC 0..1 behaviour exactly: the judge is
  // asked for a number in [scale_min, scale_max], the result clamps and
  // normalises to 0..1, and only the `score` column is filled. When
  // non-NULL we route through the type-aware prompt + parser below.
  score_config?: TypedScoreConfig | null
}

/**
 * Build the judge prompt text. Branches on the score_config data_type so
 * the judge gets a reply schema matching the column we'll write to.
 */
export function buildJudgePrompt(
  criterion: string,
  responseText: string,
  config: {
    scale_min: number
    scale_max: number
    score_config?: TypedScoreConfig | null
    /** P1-6: golden answer for golden-set comparison. Injected as a reference
     * the judge compares against; omitted when null so criterion-only scoring
     * is byte-identical to before. */
    expected_output?: string | null
  },
): string {
  const truncated = responseText.length > MAX_RESPONSE_CHARS
    ? responseText.slice(0, MAX_RESPONSE_CHARS) + '… [truncated]'
    : responseText

  // Reference (expected) answer, also truncated to the same cap.
  const expected = config.expected_output
  const referenceBlock = expected
    ? `

Reference (expected) answer to compare against:
"""
${expected.length > MAX_RESPONSE_CHARS ? expected.slice(0, MAX_RESPONSE_CHARS) + '… [truncated]' : expected}
"""
Judge how well the response matches the reference while still satisfying the criterion.`
    : ''

  const intro = `You are an evaluator. Score the assistant response below against this criterion.

Criterion: ${criterion}

Response to evaluate:
"""
${truncated}
"""${referenceBlock}`

  const sc = config.score_config

  // Legacy NUMERIC path — unchanged from before 4B.1c.
  if (!sc || sc.data_type === 'NUMERIC') {
    const min = sc?.min_value ?? config.scale_min
    const max = sc?.max_value ?? config.scale_max
    return `${intro}

Reply ONLY in JSON with this exact shape:
{"score": <number between ${min} and ${max}>, "reasoning": "<one short sentence>"}

No prose outside the JSON. No markdown fences.`
  }

  if (sc.data_type === 'BOOLEAN') {
    const trueLabel = sc.bool_true_label ?? 'pass'
    const falseLabel = sc.bool_false_label ?? 'fail'
    return `${intro}

Reply ONLY in JSON with this exact shape:
{"value": <true or false>, "reasoning": "<one short sentence>"}

\`true\` means "${trueLabel}", \`false\` means "${falseLabel}". No prose outside the JSON. No markdown fences.`
  }

  if (sc.data_type === 'CATEGORICAL') {
    const cats = Array.isArray(sc.categories)
      ? sc.categories.filter((c): c is string => typeof c === 'string')
      : []
    return `${intro}

Reply ONLY in JSON with this exact shape:
{"value": "<one of: ${cats.map((c) => JSON.stringify(c)).join(', ')}>", "reasoning": "<one short sentence>"}

The \`value\` MUST be one of the categories above, exact case match. No prose outside the JSON. No markdown fences.`
  }

  // TEXT — judge writes a free-form short answer.
  return `${intro}

Reply ONLY in JSON with this exact shape:
{"value": "<short answer>", "reasoning": "<one short sentence>"}

Keep \`value\` under 200 characters. No prose outside the JSON. No markdown fences.`
}

/**
 * Parse the judge's JSON reply into the right typed column. Falls back
 * to NUMERIC parsing (clamp + normalise to 0..1) when score_config is
 * absent or NUMERIC, which preserves the legacy behaviour exactly.
 */
export function parseJudgeReply(
  text: string,
  config: { scale_min: number; scale_max: number; score_config?: TypedScoreConfig | null },
): {
  score: number | null
  value_number: number | null
  value_string: string | null
  value_boolean: boolean | null
  reasoning: string
} | null {
  // Strip markdown fences if present.
  let cleaned = text.trim()
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  }

  let parsed: { score?: unknown; value?: unknown; reasoning?: unknown }
  try {
    parsed = JSON.parse(cleaned) as typeof parsed
  } catch {
    return null
  }
  const reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning.trim() : ''
  const sc = config.score_config

  // Legacy / explicit NUMERIC path. Keep the prior clamp + normalise so
  // result-table aggregations stay backwards compatible.
  if (!sc || sc.data_type === 'NUMERIC') {
    // Accept either {score: number} (legacy) or {value: number} (new),
    // so an LLM that drifts between the two formats still works.
    const raw = parsed.score ?? parsed.value
    const numeric = typeof raw === 'number' ? raw : Number(raw)
    if (!Number.isFinite(numeric)) return null
    const min = sc?.min_value ?? config.scale_min
    const max = sc?.max_value ?? config.scale_max
    const clamped = Math.max(min, Math.min(max, numeric))
    return {
      score: clamped, // legacy column — same value as the new path filled below
      value_number: clamped,
      value_string: null,
      value_boolean: null,
      reasoning,
    }
  }

  if (sc.data_type === 'BOOLEAN') {
    const raw = parsed.value
    let normalised: boolean | null = null
    if (typeof raw === 'boolean') normalised = raw
    else if (raw === 'true' || raw === 'pass' || raw === 'yes') normalised = true
    else if (raw === 'false' || raw === 'fail' || raw === 'no') normalised = false
    if (normalised === null) return null
    return {
      score: null,
      value_number: null,
      value_string: null,
      value_boolean: normalised,
      reasoning,
    }
  }

  if (sc.data_type === 'CATEGORICAL') {
    const raw = parsed.value
    if (typeof raw !== 'string' || raw.length === 0) return null
    const cats = Array.isArray(sc.categories)
      ? sc.categories.filter((c): c is string => typeof c === 'string')
      : []
    if (!cats.includes(raw)) return null
    return {
      score: null,
      value_number: null,
      value_string: raw,
      value_boolean: null,
      reasoning,
    }
  }

  // TEXT — accept any non-empty string, trim it. The judge has been
  // told to keep it under 200 chars; we don't strictly enforce on read
  // since human reviewers might prefer the long version.
  const raw = parsed.value
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (trimmed.length === 0) return null
  return {
    score: null,
    value_number: null,
    value_string: trimmed,
    value_boolean: null,
    reasoning,
  }
}
