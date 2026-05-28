/**
 * Client-side PII masking for display. The server already strips Authorization
 * headers and (optionally) API-key patterns from logged request bodies via
 * `apps/server/src/lib/pii-mask.ts`, but request/response bodies stored in
 * ClickHouse can still contain user-supplied natural-language PII (emails,
 * phone numbers, card numbers) inside `messages[].content`. This helper lets
 * the /requests drawer mask those at view-time when the user enables the
 * "Mask PII" toggle.
 *
 * Patterns covered:
 *   - Spanlens / Anthropic / OpenAI / Gemini API keys (mirrors server)
 *   - Email addresses
 *   - Phone numbers (NANP + generic 10+ digit runs with separators)
 *   - Credit-card-like 13–19 digit runs (Luhn-check-free; intentional broad
 *     match to favor false-positives over false-negatives when the user
 *     opted into masking).
 */

const KEY_MIN = 12

const KEY_PATTERNS: Array<{ prefix: string; regex: RegExp }> = [
  { prefix: 'sl_live_', regex: new RegExp(`sl_live_[A-Za-z0-9_-]{${KEY_MIN},}`, 'g') },
  { prefix: 'sk-ant-',  regex: new RegExp(`sk-ant-[A-Za-z0-9_-]{${KEY_MIN},}`, 'g') },
  { prefix: 'sk-proj-', regex: new RegExp(`sk-proj-[A-Za-z0-9_-]{${KEY_MIN},}`, 'g') },
  { prefix: 'sk-',      regex: new RegExp(`sk-[A-Za-z0-9_-]{${KEY_MIN},}`, 'g') },
  { prefix: 'AIza',     regex: new RegExp(`AIza[A-Za-z0-9_-]{${KEY_MIN},}`, 'g') },
]

const EMAIL_REGEX = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
// 10-15 digit phone runs with optional + and common separators (spaces, dots,
// dashes, parentheses). Anchored by word boundary so we don't eat embedded
// numeric IDs.
const PHONE_REGEX = /\b\+?\d[\d .\-()]{8,18}\d\b/g
// 13-19 contiguous digits — covers most card formats. Strips separators first
// so "4111-1111-1111-1111" matches the same as "4111111111111111".
const CARD_REGEX = /\b(?:\d[ -]?){12,18}\d\b/g

function maskEmail(match: string): string {
  const at = match.indexOf('@')
  if (at <= 1) return '***@***'
  const local = match.slice(0, at)
  const domain = match.slice(at + 1)
  const head = local.slice(0, Math.min(2, local.length))
  return `${head}***@${domain.replace(/^[^.]+/, '***')}`
}

function maskPhone(match: string): string {
  const digits = match.replace(/\D/g, '')
  if (digits.length < 10) return match
  return `${digits.slice(0, 2)}***${digits.slice(-2)}`
}

function maskCard(match: string): string {
  const digits = match.replace(/\D/g, '')
  if (digits.length < 13) return match
  return `${digits.slice(0, 4)} **** **** ${digits.slice(-4)}`
}

/** Mask API keys only. Mirrors server-side behavior. */
export function maskApiKeys(input: string): string {
  let out = input
  for (const { prefix, regex } of KEY_PATTERNS) {
    out = out.replace(regex, `${prefix}***`)
  }
  return out
}

/** Mask API keys + email/phone/card patterns. Use for opt-in display masking. */
export function maskPii(input: string): string {
  let out = maskApiKeys(input)
  // Order: cards before phones — both match long digit runs and the card
  // pattern is stricter.
  out = out.replace(CARD_REGEX, maskCard)
  out = out.replace(PHONE_REGEX, maskPhone)
  out = out.replace(EMAIL_REGEX, maskEmail)
  return out
}

/** Walks a JSON-like value and applies maskPii to every string leaf. */
export function maskPiiDeep<T>(value: T): T {
  if (typeof value === 'string') {
    return maskPii(value) as unknown as T
  }
  if (Array.isArray(value)) {
    return value.map(maskPiiDeep) as unknown as T
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      out[k] = maskPiiDeep(v)
    }
    return out as unknown as T
  }
  return value
}
