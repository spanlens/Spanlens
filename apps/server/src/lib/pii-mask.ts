/**
 * Auto-masks LLM provider API keys + Spanlens keys that may have leaked
 * into request/response bodies before they're persisted to ClickHouse.
 *
 * Scope: pattern-based masking for keys with distinctive prefixes only.
 * Natural-language PII (names, emails, card numbers, etc.) is NOT handled
 * here — that's intentional. See docs/plans/clickhouse-migration.md §3.4
 * for the policy: customers control body logging via SDK `logBody` option,
 * and full PII redaction is deferred until enterprise demand arrives.
 *
 * Patterns covered (ordered most-specific first to avoid the generic
 * `sk-` pattern eating Anthropic/OpenAI-proj keys):
 *   - Spanlens     sl_live_*           → sl_live_***
 *   - Anthropic    sk-ant-*            → sk-ant-***
 *   - OpenAI proj  sk-proj-*           → sk-proj-***
 *   - OpenAI       sk-*                → sk-***
 *   - Google       AIza* (Gemini etc.) → AIza***
 *
 * Each pattern requires ≥12 characters of key body so we don't false-positive
 * on short identifiers that happen to share the prefix. Real keys are 40+
 * characters in practice — 12 is a safe lower bound.
 */

const MIN_KEY_BODY = 12

interface KeyPattern {
  readonly name: string
  readonly prefix: string
  readonly regex: RegExp
}

// Order matters: more specific prefixes must match before the generic `sk-`
// so we replace `sk-ant-XYZ` with `sk-ant-***` rather than `sk-***`.
const PATTERNS: ReadonlyArray<KeyPattern> = [
  { name: 'spanlens',     prefix: 'sl_live_', regex: new RegExp(`sl_live_[A-Za-z0-9_-]{${MIN_KEY_BODY},}`, 'g') },
  { name: 'anthropic',    prefix: 'sk-ant-',  regex: new RegExp(`sk-ant-[A-Za-z0-9_-]{${MIN_KEY_BODY},}`, 'g') },
  { name: 'openai-proj',  prefix: 'sk-proj-', regex: new RegExp(`sk-proj-[A-Za-z0-9_-]{${MIN_KEY_BODY},}`, 'g') },
  { name: 'openai',       prefix: 'sk-',      regex: new RegExp(`sk-[A-Za-z0-9_-]{${MIN_KEY_BODY},}`, 'g') },
  { name: 'gemini',       prefix: 'AIza',     regex: new RegExp(`AIza[A-Za-z0-9_-]{${MIN_KEY_BODY},}`, 'g') },
]

/**
 * Replaces any detected API key in the input with `<prefix>***`.
 *
 * Operates only on strings — caller is responsible for serializing JSON
 * payloads first (see `maskApiKeysInBody` for the common helper).
 */
export function maskApiKeys(input: string): string {
  let result = input
  for (const { prefix, regex } of PATTERNS) {
    result = result.replace(regex, `${prefix}***`)
  }
  return result
}

/**
 * Convenience wrapper for the logger: serializes an unknown body to JSON,
 * masks API keys, and returns the string ready for ClickHouse insertion.
 * Returns an empty string for null/undefined to keep the column non-nullable.
 */
export function maskApiKeysInBody(body: unknown): string {
  if (body == null) return ''
  let serialized: string
  try {
    serialized = typeof body === 'string' ? body : JSON.stringify(body)
  } catch {
    return JSON.stringify({ _error: 'body not JSON-serializable' })
  }
  return maskApiKeys(serialized)
}
