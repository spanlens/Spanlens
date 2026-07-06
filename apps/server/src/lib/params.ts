/**
 * Query-parameter parsing helpers.
 * All functions accept `string | undefined` (the shape returned by
 * `c.req.query()`) and return a validated number, falling back to a supplied
 * default rather than throwing.
 */

import { ApiError } from './errors.js'

/** Canonical 8-4-4-4-12 UUID (any version). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Predicate for a well-formed UUID. Use for REQUIRED path params (`:id`) where
 * a malformed value should behave like a well-formed-but-nonexistent id — i.e.
 * the handler throws its own not-found `ApiError` (404) rather than letting the
 * malformed value reach the DB and surface as a raw 500. Keeps the 404 behavior
 * consistent with the file's GET/PATCH siblings.
 */
export function isUuid(raw: string | undefined | null): boolean {
  return typeof raw === 'string' && UUID_RE.test(raw)
}

/**
 * Validate an optional UUID-typed query param before it reaches a bound
 * ClickHouse `{x:UUID}` placeholder. A malformed value (e.g. `?projectId=abc`)
 * otherwise fails inside ClickHouse and surfaces as a raw 500. These read APIs
 * are documented external surfaces (the MCP server passes arbitrary filter
 * args), so a malformed value should be a clean 400 instead.
 *
 * Returns the value unchanged when present + valid, `undefined` when absent.
 * Throws `ApiError('VALIDATION_FAILED')` (→ 400) when present + malformed.
 * There is no injection risk here (the value is always bound, never
 * interpolated) — this is purely to convert a 500 into a 400.
 */
export function validateOptionalUuid(
  raw: string | undefined | null,
  field: string,
): string | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined
  if (!UUID_RE.test(raw)) {
    throw new ApiError('VALIDATION_FAILED', `${field} must be a valid UUID`)
  }
  return raw
}

/**
 * Validate an optional ISO date query param before it reaches a Postgres date
 * comparison or a ClickHouse `parseDateTime64BestEffort` binding. A garbage
 * value (e.g. `?from=garbage`) otherwise throws deep in the query layer as a
 * raw 500; convert it to a clean 400.
 *
 * Returns the value unchanged when present + parseable, `undefined` when absent.
 * Throws `ApiError('VALIDATION_FAILED')` (→ 400) when present + unparseable.
 */
export function validateOptionalDate(
  raw: string | undefined | null,
  field: string,
): string | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined
  if (Number.isNaN(Date.parse(raw))) {
    throw new ApiError('VALIDATION_FAILED', `${field} must be a valid ISO date`)
  }
  return raw
}

/** Parse a positive float; returns fallback if missing, non-finite, or ≤ 0. */
export function parsePositiveFloat(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

/** Parse a positive float clamped to [min, max]; returns fallback if invalid. */
export function parseClampedFloat(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (!raw) return fallback
  const n = Number(raw)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

/** Parse a positive integer (≥ 1); returns fallback if missing or invalid. */
export function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback
  const n = Number(raw)
  return Number.isInteger(n) && n >= 1 ? n : fallback
}

/** Parse an integer ≥ min; returns fallback if missing or invalid. */
export function parseIntMin(raw: string | undefined, fallback: number, min: number): number {
  if (!raw) return fallback
  const n = Number(raw)
  return Number.isInteger(n) && n >= min ? n : fallback
}

/**
 * Parse the standard `page` + `limit` pagination params.
 * Returns `{ page, limit, offset }` with `page` clamped to [1, maxPage] and
 * `limit` clamped to [1, maxLimit].
 *
 * Why maxPage exists: ClickHouse OFFSET is O(offset) on sorted results, so a
 * malicious `?page=99999999` would force ClickHouse to materialize-and-skip
 * billions of rows per request. With maxPage=10000 and the default
 * maxLimit=100 the worst case is 1M-row skip — still cheap on indexed scans
 * and within the ClickHouse query budget. Callers needing deeper pagination
 * must move to a cursor (`?after=<id>`) which is O(log n) instead of O(n).
 */
export function parsePageLimit(
  pageRaw: string | undefined,
  limitRaw: string | undefined,
  defaultLimit = 50,
  maxLimit = 100,
  maxPage = 10_000,
): { page: number; limit: number; offset: number } {
  const rawPage = Math.max(1, parseInt(pageRaw ?? '1', 10) || 1)
  const page = Math.min(maxPage, rawPage)
  const limit = Math.min(maxLimit, Math.max(1, parseInt(limitRaw ?? String(defaultLimit), 10) || defaultLimit))
  return { page, limit, offset: (page - 1) * limit }
}
