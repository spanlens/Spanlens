/**
 * Security scan for LLM request bodies: PII detection + prompt injection.
 *
 * Principles:
 *   - Pure functions — easy to test, no DB/network side effects.
 *   - Compact flags suitable for JSONB storage in requests.flags column.
 *   - "sample" is a ~20-char masked excerpt so the flag is actionable
 *     without dumping the raw match back into the DB.
 *   - Scans the serialized request body. Upstream caller is responsible
 *     for passing in what they want scanned.
 */

export type FlagType = 'pii' | 'injection'

export interface SecurityFlag {
  type: FlagType
  pattern: string   // which rule fired, e.g. 'ssn-kr', 'email', 'prompt-injection:ignore-previous'
  sample: string    // masked excerpt around the match, for auditability
}

// ── PII patterns ───────────────────────────────────────────────────────
// We lean conservative: patterns chosen to minimize false positives on
// normal English/Korean prose. Prefer structural shape (digit groupings)
// over keywords.

interface PiiRule {
  name: string
  re: RegExp
}

const PII_RULES: readonly PiiRule[] = [
  // Korean resident registration number (주민등록번호): 6 digits - 7 digits
  { name: 'ssn-kr', re: /\b\d{6}[-]\d{7}\b/g },
  // US SSN: 3-2-4
  { name: 'ssn-us', re: /\b\d{3}-\d{2}-\d{4}\b/g },
  // IBAN (International Bank Account Number) — 34+ countries (EU, UK, CH, NO, …)
  // Matches compact (GB82WEST12345698765432) and 4-char-spaced (GB82 WEST 1234 5698 7654 32) forms.
  // Minimum 15 chars (Norway NO), maximum 34 chars (Malta MT).
  // mod-97 checksum validation applied per-match to eliminate false positives (~99% rejection rate).
  { name: 'iban', re: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z\d]{4}){2,7}(?:[ ]?[A-Z\d]{0,3})?\b/g },
  // Credit card numbers (Luhn-passing 13-19 digits, common groupings)
  { name: 'credit-card', re: /\b(?:\d[ -]*?){13,19}\b/g },
  // Email addresses
  { name: 'email', re: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  // Phone numbers — require either explicit country-code (+) or grouped format
  // (parens or 0-prefixed Korean style). Avoids false-positives on bare digit
  // runs (order IDs, IP-like 3-3-3-3 sequences).
  { name: 'phone', re: /(?:\+\d{1,3}[-. ]\d{1,4}[-. ]\d{3,4}[-. ]\d{3,4}|\(\d{2,4}\)\s?\d{3,4}[-. ]\d{3,4}|\b0\d{1,2}[-. ]\d{3,4}[-. ]\d{4}\b)/g },
  // Passport numbers — require nearby keyword (passport / 여권) to avoid
  // false-positives on version strings (V20240101), SKUs (AB123456), error
  // codes, etc. False negative on bare passport numbers is acceptable for an
  // observability tool. No `\b` anchor: JS regex \b is ASCII-only so Korean
  // 여권 wouldn't match against word-boundaries; the keyword itself is
  // specific enough.
  { name: 'passport', re: /(?:passport|여권)(?:\s*(?:no\.?|number|번호))?[\s:#]{1,5}([A-Z]{1,2}\d{6,8})\b/gi },
]

// ── Prompt-injection patterns ──────────────────────────────────────────
// These are well-known social-engineering phrases used to override system
// prompts. Case-insensitive word-boundary matches only.

interface InjectionRule {
  name: string
  re: RegExp
}

const INJECTION_RULES: readonly InjectionRule[] = [
  // ── English patterns ──────────────────────────────────────────────────
  { name: 'ignore-previous', re: /\b(ignore|disregard|forget)\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?|directives?)\b/gi },
  { name: 'reveal-system-prompt', re: /\b(what|show|reveal|print|tell me)\s+.{0,30}?(your\s+)?(system|initial|original|hidden)\s+(prompt|instructions?|rules?)\b/gi },
  { name: 'role-override', re: /\b(you\s+are\s+now|from\s+now\s+on(?:,?\s+you)?|act\s+as|pretend\s+(to\s+be|you\s+are))\s+(?!a\s+helpful)/gi },
  { name: 'developer-mode', re: /\b(developer|debug|jailbreak|DAN|do\s+anything\s+now)\s+mode\b/gi },
  { name: 'token-smuggle', re: /<\|(?:system|im_start|im_end|endoftext)\|>/gi },
  // ── Korean patterns ───────────────────────────────────────────────────
  // "이전/앞/모든/기존 지시사항/명령/프롬프트/규칙 무시해/잊어버려"
  { name: 'ignore-previous-ko', re: /(?:이전|앞(?:의|에)?|위(?:의|에)?|모든|기존|처음)[\s\S]{0,15}(?:지시|명령|프롬프트|규칙|설정)(?:사항|들)?[\s\S]{0,10}(?:무시|잊어버)/ },
  // "시스템/초기/숨겨진 프롬프트/지시사항 알려줘/보여줘/말해줘"
  { name: 'reveal-system-ko', re: /(?:시스템|초기|숨겨진|원래)\s*(?:프롬프트|지시(?:사항)?|명령|설정)[\s\S]{0,20}(?:알려|보여|말해|공개|출력|뭐야|뭔지)/ },
  // "이제부터/지금부터 너는..." OR "~인 척 해" / "~역할 해줘"
  { name: 'role-override-ko', re: /(?:이제부터|지금부터|앞으로는?)\s*(?:너는|당신은|네가|you)|(?:인\s*척\s*해|처럼\s*행동\s*해|역할\s*(?:을\s*)?해줘)/ },
]

// ── Utilities ──────────────────────────────────────────────────────────

function maskSample(source: string, matchIndex: number, matchLength: number): string {
  // Show 6 chars around the match, everything else masked.
  const start = Math.max(0, matchIndex - 3)
  const end = Math.min(source.length, matchIndex + matchLength + 3)
  const slice = source.slice(start, end)
  if (matchLength <= 6) return slice.replace(/./g, (c, i) => (i < 2 || i > slice.length - 3 ? c : '*'))
  // For longer matches, keep first 2 and last 2 chars of the match, mask middle.
  const prefix = source.slice(start, matchIndex + 2)
  const masked = '*'.repeat(Math.min(matchLength - 4, 6))
  const suffix = source.slice(matchIndex + matchLength - 2, end)
  return `${prefix}${masked}${suffix}`
}

function serialize(input: unknown): string {
  if (typeof input === 'string') return input
  if (input == null) return ''
  try {
    return JSON.stringify(input)
  } catch {
    return ''
  }
}

// ── Scanners ───────────────────────────────────────────────────────────

export function scanPii(text: string): SecurityFlag[] {
  if (!text) return []
  const flags: SecurityFlag[] = []
  const seen = new Set<string>()

  for (const rule of PII_RULES) {
    rule.re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = rule.re.exec(text)) !== null) {
      const key = `${rule.name}:${m.index}`
      if (seen.has(key)) continue
      seen.add(key)
      // Luhn check for credit-card rule to cut false positives
      if (rule.name === 'credit-card') {
        const digits = m[0].replace(/\D/g, '')
        if (!luhnValid(digits)) continue
      }
      // mod-97 checksum for IBAN to cut false positives
      if (rule.name === 'iban') {
        if (!ibanValid(m[0])) continue
      }
      flags.push({
        type: 'pii',
        pattern: rule.name,
        sample: maskSample(text, m.index, m[0].length),
      })
      if (flags.length >= 10) return flags // cap to avoid jsonb bloat
    }
  }
  return flags
}

export function scanInjection(text: string): SecurityFlag[] {
  if (!text) return []
  const flags: SecurityFlag[] = []

  for (const rule of INJECTION_RULES) {
    rule.re.lastIndex = 0
    const m = rule.re.exec(text)
    if (m) {
      flags.push({
        type: 'injection',
        pattern: `prompt-injection:${rule.name}`,
        sample: maskSample(text, m.index, Math.min(m[0].length, 40)),
      })
    }
  }
  return flags
}

export function scanAll(body: unknown): SecurityFlag[] {
  const text = serialize(body)
  if (!text) return []
  const combined = [...scanInjection(text), ...scanPii(text)]
  return combined.slice(0, 10)
}

/**
 * IBAN mod-97 checksum validation (ISO 13616).
 * Accepts compact or space-separated forms; strips spaces before validating.
 * Returns true only if the IBAN is structurally valid and the check digit is correct.
 * Uses BigInt to avoid floating-point precision loss on large digit strings.
 */
function ibanValid(raw: string): boolean {
  const s = raw.replace(/\s/g, '').toUpperCase()
  if (s.length < 15 || s.length > 34) return false
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(s)) return false
  // Move country code + check digits (first 4 chars) to end
  const rearranged = s.slice(4) + s.slice(0, 4)
  // Replace each letter with its numeric equivalent: A=10 … Z=35
  const numeric = rearranged.replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55))
  try {
    return BigInt(numeric) % 97n === 1n
  } catch {
    return false
  }
}

function luhnValid(digits: string): boolean {
  if (digits.length < 13 || digits.length > 19) return false
  let sum = 0
  let alt = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i])
    if (alt) {
      n *= 2
      if (n > 9) n -= 9
    }
    sum += n
    alt = !alt
  }
  return sum % 10 === 0
}
