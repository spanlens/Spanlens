/**
 * Small coercion helpers for hand-rolled request-body validation at the API
 * boundary. The codebase does not use a schema library (Zod); these mirror the
 * pattern that grew up in api/scoreConfigs.ts and are useful at any router that
 * accepts `unknown` JSON and needs to narrow scalar fields safely.
 *
 * Adopting a schema library is a separate, larger decision; until then these
 * are the shared building blocks so each router does not re-roll the same
 * trim/finite-number checks.
 */

/** Coerce to a trimmed string; non-strings become ''. */
export function normaliseString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** Coerce to a trimmed string, or null when empty/non-string. */
export function normaliseNullableString(value: unknown): string | null {
  const s = normaliseString(value)
  return s.length === 0 ? null : s
}

/** Coerce to a finite number, or null when null/undefined/non-finite. */
export function normaliseNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}
