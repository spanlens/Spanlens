/**
 * Per-provider roll-up for get_stats(groupBy='provider').
 *
 * The server has no provider-level stats endpoint: /api/v1/stats/models
 * groups by (provider, model) (apps/server/src/lib/stats-queries.ts
 * getStatsModels). v0.2.1 returned those rows unchanged for both groupBy
 * values, so a "by provider" question got a per-model table and the LLM
 * had to add it up, typically by averaging the averages. Here the rows are
 * combined properly: counts and cost are summed, latency and error rate
 * are weighted by each row's request count.
 */

export interface ModelStatsRow {
  provider: string
  model: string
  requests: number
  totalCostUsd: number
  avgLatencyMs: number
  errorRate: number
}

export interface ProviderStatsRow {
  provider: string
  /** Models seen for this provider, in the server's order (cost, highest first). */
  models: string[]
  requests: number
  totalCostUsd: number
  /** Request-weighted mean of the per-model averages, rounded like the server's. */
  avgLatencyMs: number
  errorRate: number
}

const SOURCE = '/api/v1/stats/models'

/** Numbers can arrive as strings (numeric/int8 over JSON); anything else counts as 0. */
function toNumber(value: unknown): number {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  return typeof n === 'number' && Number.isFinite(n) ? n : 0
}

function toModelRow(value: unknown): ModelStatsRow {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Unexpected response from ${SOURCE}: expected a list of rows.`)
  }
  const r = value as Record<string, unknown>
  return {
    provider: typeof r['provider'] === 'string' ? r['provider'] : '',
    model: typeof r['model'] === 'string' ? r['model'] : '',
    requests: toNumber(r['requests']),
    totalCostUsd: toNumber(r['totalCostUsd']),
    avgLatencyMs: toNumber(r['avgLatencyMs']),
    errorRate: toNumber(r['errorRate']),
  }
}

/** The server rounds cost to 6 dp; summing floats reintroduces noise (0.1 + 0.2). */
function roundUsd(value: number): number {
  return Math.round(value * 1e6) / 1e6
}

function combine(provider: string, rows: readonly ModelStatsRow[]): ProviderStatsRow {
  const requests = rows.reduce((sum, r) => sum + r.requests, 0)
  const latencyWeight = rows.reduce((sum, r) => sum + r.avgLatencyMs * r.requests, 0)
  // errorRate is errors / requests per row, so rounding the product recovers
  // the exact error count and the combined rate stays exact.
  const errors = rows.reduce((sum, r) => sum + Math.round(r.errorRate * r.requests), 0)
  return {
    provider,
    models: rows.map((r) => r.model),
    requests,
    totalCostUsd: roundUsd(rows.reduce((sum, r) => sum + r.totalCostUsd, 0)),
    avgLatencyMs: requests > 0 ? Math.round(latencyWeight / requests) : 0,
    errorRate: requests > 0 ? errors / requests : 0,
  }
}

function byCostThenVolume(a: ProviderStatsRow, b: ProviderStatsRow): number {
  return (
    b.totalCostUsd - a.totalCostUsd ||
    b.requests - a.requests ||
    a.provider.localeCompare(b.provider)
  )
}

/**
 * Combine /stats/models rows into one row per provider, highest cost
 * first. Throws when the payload is not a list of row objects, so the
 * tool reports a clear error instead of an empty or garbled table.
 */
export function aggregateByProvider(data: unknown): ProviderStatsRow[] {
  if (!Array.isArray(data)) {
    throw new Error(`Unexpected response from ${SOURCE}: expected a list of rows.`)
  }
  const rows = data.map(toModelRow)
  const providers = [...new Set(rows.map((r) => r.provider))]
  return providers
    .map((provider) => combine(provider, rows.filter((r) => r.provider === provider)))
    .sort(byCostThenVolume)
}
