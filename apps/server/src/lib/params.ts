/**
 * Query-parameter parsing helpers.
 * All functions accept `string | undefined` (the shape returned by
 * `c.req.query()`) and return a validated number, falling back to a supplied
 * default rather than throwing.
 */

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
