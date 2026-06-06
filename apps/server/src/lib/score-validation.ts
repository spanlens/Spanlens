/**
 * Score config validation.
 *
 * Turns a (config, raw value) pair into the typed value columns that go
 * into eval_results / human_evals, and surfaces user-friendly errors for
 * the four cases the API exposes:
 *
 *   • NUMERIC value out of [min, max]
 *   • CATEGORICAL value not in the allow-list
 *   • BOOLEAN value not coercible to true/false
 *   • TEXT value empty / non-string (we treat "" as not-a-score)
 *
 * The output shape is exactly the columns the result tables expect, so
 * callers can spread it into an insert without re-mapping. The
 * legacy `score` column is also filled when the config is NUMERIC, so
 * pre-4B.1 dashboard queries (AVG(score)) keep working.
 */

export type ScoreConfigType = 'NUMERIC' | 'CATEGORICAL' | 'BOOLEAN' | 'TEXT'

export interface ScoreConfig {
  id: string
  data_type: ScoreConfigType
  min_value: number | null
  max_value: number | null
  categories: unknown // JSONB — validated at runtime
  bool_true_label: string | null
  bool_false_label: string | null
}

export interface NormalizedScoreFields {
  /** Legacy numeric mirror; null when the score isn't numeric. */
  score: number | null
  value_number: number | null
  value_string: string | null
  value_boolean: boolean | null
}

export interface ValidationOk {
  ok: true
  fields: NormalizedScoreFields
}

export interface ValidationErr {
  ok: false
  /** Stable code the API can map to an HTTP status. */
  code:
    | 'INVALID_NUMERIC'
    | 'NUMERIC_OUT_OF_RANGE'
    | 'INVALID_CATEGORICAL'
    | 'INVALID_BOOLEAN'
    | 'INVALID_TEXT'
    | 'INVALID_CONFIG'
  /** Human-readable message safe to surface in 4xx responses. */
  message: string
}

export type ValidationResult = ValidationOk | ValidationErr

/**
 * Validate a raw value against a config and return the typed columns to
 * write. The caller must already have loaded the config from
 * `score_configs` and confirmed it belongs to the right organization.
 *
 * Accepts a single `value` argument so call sites for NUMERIC don't have
 * to invent a string. Type coercion is intentionally narrow — JS's
 * `Boolean(value)` would happily accept the string "false" as `true`,
 * which is exactly the kind of footgun we want to surface as a 400.
 */
export function validateScore(config: ScoreConfig, value: unknown): ValidationResult {
  switch (config.data_type) {
    case 'NUMERIC':
      return validateNumeric(config, value)
    case 'CATEGORICAL':
      return validateCategorical(config, value)
    case 'BOOLEAN':
      return validateBoolean(config, value)
    case 'TEXT':
      return validateText(value)
    default: {
      // The CHECK constraint at the DB level prevents this in practice,
      // but we guard the API layer so a corrupted row can't crash the
      // process.
      const exhaustive: never = config.data_type
      return {
        ok: false,
        code: 'INVALID_CONFIG',
        message: `Unknown score type: ${String(exhaustive)}`,
      }
    }
  }
}

function validateNumeric(config: ScoreConfig, value: unknown): ValidationResult {
  // Accept number or numeric string. NaN and infinity rejected.
  const raw = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(raw)) {
    return { ok: false, code: 'INVALID_NUMERIC', message: 'score must be a finite number' }
  }

  const min = config.min_value ?? 0
  const max = config.max_value ?? 1
  if (raw < min || raw > max) {
    return {
      ok: false,
      code: 'NUMERIC_OUT_OF_RANGE',
      message: `score ${raw} is outside the configured range [${min}, ${max}]`,
    }
  }

  return {
    ok: true,
    fields: {
      score: raw,
      value_number: raw,
      value_string: null,
      value_boolean: null,
    },
  }
}

function validateCategorical(config: ScoreConfig, value: unknown): ValidationResult {
  if (typeof value !== 'string' || value.length === 0) {
    return {
      ok: false,
      code: 'INVALID_CATEGORICAL',
      message: 'score must be one of the configured categories',
    }
  }

  const categories = parseCategories(config.categories)
  if (!categories.includes(value)) {
    return {
      ok: false,
      code: 'INVALID_CATEGORICAL',
      message: `score "${value}" is not in the allowed categories: ${categories.join(', ')}`,
    }
  }

  return {
    ok: true,
    fields: {
      score: null,
      value_number: null,
      value_string: value,
      value_boolean: null,
    },
  }
}

function validateBoolean(_config: ScoreConfig, value: unknown): ValidationResult {
  // Accept the actual boolean, the two true/false strings, and the two
  // labels the workspace might have configured. Anything else is a 400.
  let normalised: boolean | null = null
  if (typeof value === 'boolean') {
    normalised = value
  } else if (value === 'true' || value === 'pass' || value === 'yes' || value === 1) {
    normalised = true
  } else if (value === 'false' || value === 'fail' || value === 'no' || value === 0) {
    normalised = false
  }

  if (normalised === null) {
    return {
      ok: false,
      code: 'INVALID_BOOLEAN',
      message: 'score must be a boolean (true/false)',
    }
  }

  return {
    ok: true,
    fields: {
      score: null,
      value_number: null,
      value_string: null,
      value_boolean: normalised,
    },
  }
}

function validateText(value: unknown): ValidationResult {
  if (typeof value !== 'string') {
    return { ok: false, code: 'INVALID_TEXT', message: 'score must be a string' }
  }
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return { ok: false, code: 'INVALID_TEXT', message: 'score must not be empty' }
  }
  return {
    ok: true,
    fields: {
      score: null,
      value_number: null,
      value_string: trimmed,
      value_boolean: null,
    },
  }
}

/**
 * Parse the JSONB `categories` column into a string array. JSONB comes
 * back as a parsed JS value from PostgREST so we just need to coerce
 * the shape; any non-string entries are filtered out rather than
 * throwing so a half-broken config doesn't 500 the whole route.
 */
export function parseCategories(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((v): v is string => typeof v === 'string' && v.length > 0)
}

/**
 * Validation guards for the *config* itself (used by the CRUD route).
 * Returns null when the config row is shaped consistently for its type,
 * an error string otherwise.
 */
export function validateScoreConfigShape(input: {
  data_type: string
  min_value: number | null
  max_value: number | null
  categories: unknown
}): string | null {
  switch (input.data_type) {
    case 'NUMERIC': {
      const min = input.min_value
      const max = input.max_value
      if (min === null || max === null) return 'NUMERIC config requires min_value and max_value'
      if (!Number.isFinite(min) || !Number.isFinite(max)) return 'NUMERIC bounds must be finite'
      if (min >= max) return 'min_value must be strictly less than max_value'
      return null
    }
    case 'CATEGORICAL': {
      const categories = parseCategories(input.categories)
      if (categories.length < 2) return 'CATEGORICAL config requires at least 2 categories'
      const dedup = new Set(categories)
      if (dedup.size !== categories.length) return 'category names must be unique'
      return null
    }
    case 'BOOLEAN':
    case 'TEXT':
      return null
    default:
      return `Unknown data_type: ${input.data_type}`
  }
}
