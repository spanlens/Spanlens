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
  // Credit card numbers (Luhn-passing 13-19 digits, common groupings)
  { name: 'credit-card', re: /\b(?:\d[ -]*?){13,19}\b/g },
  // Email addresses
  { name: 'email', re: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  // International phone (E.164 + common formats) — 10-15 digits
  { name: 'phone', re: /\b(?:\+?\d{1,3}[-. ]?)?(?:\(?\d{2,4}\)?[-. ]?)\d{3,4}[-. ]?\d{3,4}\b/g },
  // Passport numbers (generic letter+digits pattern, 6-9 chars)
  { name: 'passport', re: /\b[A-Z]{1,2}\d{6,8}\b/g },
]

// ── Prompt-injection patterns ──────────────────────────────────────────
// These are well-known social-engineering phrases used to override system
// prompts. Case-insensitive word-boundary matches only.

interface InjectionRule {
  name: string
  re: RegExp
}

const INJECTION_RULES: readonly InjectionRule[] = [
  { name: 'ignore-previous', re: /\b(ignore|disregard|forget)\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?|directives?)\b/gi },
  { name: 'reveal-system-prompt', re: /\b(what|show|reveal|print|tell me)\s+.{0,30}?(your\s+)?(system|initial|original|hidden)\s+(prompt|instructions?|rules?)\b/gi },
  { name: 'role-override', re: /\b(you\s+are\s+now|from\s+now\s+on(?:,?\s+you)?|act\s+as|pretend\s+(to\s+be|you\s+are))\s+(?!a\s+helpful)/gi },
  { name: 'developer-mode', re: /\b(developer|debug|jailbreak|DAN|do\s+anything\s+now)\s+mode\b/gi },
  { name: 'token-smuggle', re: /<\|(?:system|im_start|im_end|endoftext)\|>/gi },
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
  return [...scanPii(text), ...scanInjection(text)]
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
