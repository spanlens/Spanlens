/**
 * The `requests` filters shared by the dashboard list (`GET /api/v1/requests`)
 * and the export (`GET /api/v1/exports/requests`).
 *
 * They used to be parsed twice. The export's copy fell behind: it ignored
 * `userId`, `sessionId`, `promptVersionId` and `truncated`, did not know the
 * `success` / `error` status synonyms, and skipped the uuid/date validation.
 * So "Export" on a page filtered to one customer downloaded every customer's
 * rows, and a malformed id failed inside the database after a streamed 200
 * was already on the wire (XVERIFY-2026-09-28 C10.2). One parser keeps the
 * two from drifting again.
 *
 * Output is WHERE fragments with `{name}` placeholders plus the values to
 * bind; lib/postgres.ts turns the placeholders into `$n`. User input never
 * enters the SQL text.
 */

import { ApiError } from './errors.js'
import { validateOptionalDate, validateOptionalUuid } from './params.js'

export interface RequestFilters {
  /** Conditions joined with AND, no leading AND. Undefined when nothing filters. */
  readonly sql: string | undefined
  readonly params: Readonly<Record<string, unknown>>
}

export interface ParseRequestFiltersOptions {
  /**
   * Reject an unrecognised `status` / `truncated` value with a 400 instead of
   * ignoring it. The list endpoint stays lenient because existing callers
   * rely on that. The export turns it on: a typo there silently widens a file
   * the user takes away, not a page they can see is unfiltered.
   */
  readonly strictEnums?: boolean
}

type QueryReader = (name: string) => string | undefined

/** `null` means "no condition"; `all` is accepted as an explicit no-op. */
const STATUS_CONDITIONS: Readonly<Record<string, string | null>> = {
  all: null,
  // `success` / `error` are friendly synonyms for callers without HTTP
  // intuition (MCP tools, BI dashboards).
  ok: 'status_code < 400',
  success: 'status_code < 400',
  '4xx': 'status_code >= 400 AND status_code < 500',
  '5xx': 'status_code >= 500',
  error: 'status_code >= 400',
}

// ?truncated=true  → only rows that hit the stream deadline
// ?truncated=false → only rows that completed cleanly
const TRUNCATED_CONDITIONS: Readonly<Record<string, string | null>> = {
  all: null,
  true: 'truncated = true',
  false: 'truncated = false',
}

/**
 * Validates an optional date and returns it as canonical ISO UTC.
 *
 * `Date.parse` accepts forms `timestamptz` does not (V8 reads `?from=1` as a
 * year), so binding the raw string would let a value pass validation and then
 * fail the cast in Postgres. Binding the normalised string closes that gap.
 * Years outside 1..9999 would serialise as an expanded ISO year (`+275760-…`)
 * that the cast also rejects, so they are refused up front.
 */
function parseOptionalTimestamp(raw: string | undefined, field: string): string | undefined {
  const valid = validateOptionalDate(raw, field)
  if (valid === undefined) return undefined
  const date = new Date(valid)
  const year = date.getUTCFullYear()
  if (year < 1 || year > 9999) {
    throw new ApiError('VALIDATION_FAILED', `${field} must be a valid ISO date`)
  }
  return date.toISOString()
}

function enumCondition(
  table: Readonly<Record<string, string | null>>,
  raw: string | undefined,
  field: string,
  strict: boolean,
): string | null {
  if (!raw) return null
  // Own keys only: `?status=constructor` must not find Object.prototype.
  if (Object.hasOwn(table, raw)) return table[raw] ?? null
  if (strict) {
    throw new ApiError(
      'VALIDATION_FAILED',
      `${field} must be one of: ${Object.keys(table).join(', ')}`,
    )
  }
  return null
}

/**
 * Parses and validates the request filters from a query-string reader
 * (`(name) => c.req.query(name)`).
 *
 * Throws `ApiError('VALIDATION_FAILED')` (400) for a malformed uuid or date,
 * and, with `strictEnums`, for an unknown `status` / `truncated` value. The
 * error surfaces before any query runs, which on the streamed export means
 * before the response starts.
 */
export function parseRequestFilters(
  query: QueryReader,
  options: ParseRequestFiltersOptions = {},
): RequestFilters {
  const strict = options.strictEnums === true

  // Validate everything before assembling anything, so the first malformed
  // field is the one reported.
  const projectId = validateOptionalUuid(query('projectId'), 'projectId')
  const from = parseOptionalTimestamp(query('from'), 'from')
  const to = parseOptionalTimestamp(query('to'), 'to')
  const providerKeyId = validateOptionalUuid(query('providerKeyId'), 'providerKeyId')
  const promptVersionId = validateOptionalUuid(query('promptVersionId'), 'promptVersionId')
  const statusCondition = enumCondition(STATUS_CONDITIONS, query('status'), 'status', strict)
  const truncatedCondition = enumCondition(TRUNCATED_CONDITIONS, query('truncated'), 'truncated', strict)

  const bound: ReadonlyArray<readonly [string, string, string | undefined]> = [
    ['project_id = {projectId}', 'projectId', projectId],
    ['provider = {provider}', 'provider', query('provider') || undefined],
    // Literal, case-insensitive substring match. Not ILIKE: `%` / `_` in a
    // search term would turn into wildcards (CLAUDE.md gotcha #20).
    ['position(lower({model}) in lower(model)) > 0', 'model', query('model') || undefined],
    ['provider_key_id = {providerKeyId}', 'providerKeyId', providerKeyId],
    ['prompt_version_id = {promptVersionId}', 'promptVersionId', promptVersionId],
    ['user_id = {userId}', 'userId', query('userId') || undefined],
    ['session_id = {sessionId}', 'sessionId', query('sessionId') || undefined],
    ['created_at >= {from}::timestamptz', 'from', from],
    ['created_at <= {to}::timestamptz', 'to', to],
  ]
  const present = bound.filter(([, , value]) => value !== undefined)

  const conditions = [
    ...present.map(([condition]) => condition),
    ...[statusCondition, truncatedCondition].filter((c): c is string => c !== null),
  ]
  const params = Object.fromEntries(present.map(([, name, value]) => [name, value]))

  return {
    sql: conditions.length > 0 ? conditions.join(' AND ') : undefined,
    params,
  }
}
