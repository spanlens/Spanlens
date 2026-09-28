/**
 * The /requests table filters, in one shape shared by every read that has to
 * agree with the table: the list itself, the KPI strip and traffic chart
 * (`/api/v1/stats/*`), and the export (`/api/v1/exports/requests`).
 *
 * The names are the query parameter names all three endpoints accept. When a
 * reader picked its own subset, an export from `/requests?userId=...`
 * downloaded every customer's rows and the KPI strip ignored every filter but
 * time.
 */
export interface RequestsTableFilters {
  provider?: string | undefined
  /** Case-insensitive literal substring on the server. */
  model?: string | undefined
  providerKeyId?: string | undefined
  /** `ok` | `4xx` | `5xx` (the server also accepts `success` / `error`). */
  status?: string | undefined
  promptVersionId?: string | undefined
  userId?: string | undefined
  sessionId?: string | undefined
  truncated?: 'true' | 'false' | undefined
}

const FILTER_KEYS = [
  'provider',
  'model',
  'providerKeyId',
  'status',
  'promptVersionId',
  'userId',
  'sessionId',
  'truncated',
] as const satisfies readonly (keyof RequestsTableFilters)[]

/**
 * Drops blank values. Returns `undefined` when nothing is left so an
 * unfiltered caller builds the same query key it always did; the dashboard's
 * overview and timeseries keys are prefetched on the server without filters.
 */
export function compactRequestsFilters(
  filters: RequestsTableFilters | undefined,
): RequestsTableFilters | undefined {
  if (!filters) return undefined
  const entries = FILTER_KEYS.flatMap((key) => {
    const value = filters[key]?.trim()
    return value ? [[key, value] as const] : []
  })
  return entries.length > 0 ? (Object.fromEntries(entries) as RequestsTableFilters) : undefined
}

/** A copy of `qs` with every set filter appended. */
export function appendRequestsFilters(
  qs: URLSearchParams,
  filters: RequestsTableFilters | undefined,
): URLSearchParams {
  const next = new URLSearchParams(qs)
  const compact = compactRequestsFilters(filters) ?? {}
  for (const key of FILTER_KEYS) {
    const value = compact[key]
    if (value) next.set(key, value)
  }
  return next
}

/** Export URL for exactly the rows the table is showing. */
export function buildRequestsExportPath(
  format: string,
  filters: RequestsTableFilters,
  fromIso?: string,
): string {
  const qs = appendRequestsFilters(new URLSearchParams({ format }), filters)
  if (fromIso) qs.set('from', fromIso)
  return `/api/v1/exports/requests?${qs.toString()}`
}

/** `?truncated=` accepts only true/false; anything else means no filter. */
export function parseTruncatedParam(raw: string | null | undefined): 'true' | 'false' | undefined {
  return raw === 'true' || raw === 'false' ? raw : undefined
}

/**
 * Anomalies are detected per (provider, model), so only those two filters can
 * narrow them. Model matching mirrors the server: literal and
 * case-insensitive, never a pattern.
 */
export function anomalyMatchesFilters(
  anomaly: { provider: string; model: string },
  filters: RequestsTableFilters | undefined,
): boolean {
  const provider = filters?.provider?.trim()
  const model = filters?.model?.trim().toLowerCase()
  if (provider && anomaly.provider !== provider) return false
  if (model && !anomaly.model.toLowerCase().includes(model)) return false
  return true
}
