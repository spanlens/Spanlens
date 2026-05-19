import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../middleware/authJwt.js'
import { parseClampedFloat } from '../lib/params.js'
import {
  getStatsOverview,
  getStatsModels,
  getStatsTimeseries,
  getLatencyPercentiles,
  type OverviewRow,
  type TimeseriesRow,
} from '../lib/stats-queries.js'
import { withStatsCache, STATS_SWR, STATS_SWR_SLOW } from '../lib/stats-cache.js'

/**
 * Stats endpoints — SQL-aggregated server-side.
 *
 * Originally these called Postgres stored functions (stats_overview /
 * stats_models / stats_timeseries) against the Supabase requests table.
 * After the ClickHouse migration the requests data lives in ClickHouse and
 * the aggregation moves with it — see lib/stats-queries.ts for the SQL.
 * The response contract is unchanged so the dashboard didn't need updates.
 */

export const statsRouter = new Hono<JwtContext>()

statsRouter.use('*', authJwt)

// Cache-Control presets for stats endpoints.
// `private` — per-user data, never store on shared/CDN caches.
// `max-age=N` — browser may serve cached response for N seconds without revalidation.
// `stale-while-revalidate=M` — after max-age, serve stale for M seconds while refetching in background.
// Dashboard auto-refetch is 2min + realtime WS; 10s freshness window cuts repeat-nav fetches to ~0ms.
const CACHE_STATS_LIVE = 'private, max-age=10, stale-while-revalidate=30'
const CACHE_STATS_FORECAST = 'private, max-age=60, stale-while-revalidate=300'

function pctDelta(current: number, previous: number): number | null {
  if (previous === 0) return null
  return parseFloat(((current - previous) / previous * 100).toFixed(1))
}

function rowToOverview(row: OverviewRow) {
  return {
    totalRequests: row.total_requests,
    successRequests: row.success_requests,
    errorRequests: row.error_requests,
    totalCostUsd: parseFloat(row.total_cost_usd.toFixed(6)),
    totalTokens: row.total_tokens,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    avgLatencyMs: Math.round(row.avg_latency_ms),
    errorRate: row.total_requests > 0 ? row.error_requests / row.total_requests : 0,
  }
}

// GET /api/v1/stats/overview?compare=true
statsRouter.get('/overview', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const projectId = c.req.query('projectId')
  const from = c.req.query('from')
  const to = c.req.query('to')
  const compare = c.req.query('compare') === 'true'

  // Cache key MUST include orgId. The web client rounds `from` to the minute
  // so two callers in the same org/minute share a cache slot.
  const cacheKey = `org:${orgId}:stats:overview:${from ?? ''}:${to ?? ''}:${projectId ?? ''}:${compare}`

  try {
    const payload = await withStatsCache(c, cacheKey, STATS_SWR, async () => {
      if (compare) {
        // Compute previous period of equal duration, run both in parallel.
        const nowMs = Date.now()
        const toMs = to ? new Date(to).getTime() : nowMs
        const fromMs = from ? new Date(from).getTime() : toMs - 30 * 24 * 3_600_000
        const duration = toMs - fromMs
        const prevTo = new Date(fromMs).toISOString()
        const prevFrom = new Date(fromMs - duration).toISOString()

        const [curr, prev] = await Promise.all([
          getStatsOverview(orgId, { projectId, from: from ?? null, to: to ?? null }),
          getStatsOverview(orgId, { projectId, from: prevFrom, to: prevTo }),
        ])

        const currRow = rowToOverview(curr)
        const prevRow = rowToOverview(prev)

        return {
          ...currRow,
          requestsDelta: pctDelta(currRow.totalRequests, prevRow.totalRequests),
          costDelta: pctDelta(currRow.totalCostUsd, prevRow.totalCostUsd),
          latencyDelta: pctDelta(currRow.avgLatencyMs, prevRow.avgLatencyMs),
          errorRateDelta: pctDelta(currRow.errorRate, prevRow.errorRate),
        }
      }

      const overview = await getStatsOverview(orgId, {
        projectId,
        from: from ?? null,
        to: to ?? null,
      })
      return rowToOverview(overview)
    })

    c.header('Cache-Control', CACHE_STATS_LIVE)
    return c.json({ success: true, data: payload })
  } catch (err) {
    console.error('[stats:overview] ClickHouse query failed:', err instanceof Error ? err.message : err)
    return c.json({ error: 'Failed to fetch stats' }, 500)
  }
})

function selectGranularity(fromIso: string | null): 'hour' | 'day' {
  if (!fromIso) return 'day'
  const rangeHours = (Date.now() - new Date(fromIso).getTime()) / 3_600_000
  return rangeHours <= 48 ? 'hour' : 'day'
}

// GET /api/v1/stats/models?hours=24 — per-model breakdown, sorted by cost desc
statsRouter.get('/models', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const hours = parseClampedFloat(c.req.query('hours'), 24, 0.001, 24 * 30)
  const projectId = c.req.query('projectId')
  // Bucket fromIso to the minute so concurrent callers in the same org share a key.
  const fromIsoRaw = new Date(Date.now() - hours * 3_600_000).toISOString()
  const fromIso = fromIsoRaw.slice(0, 16) + ':00.000Z'

  const cacheKey = `org:${orgId}:stats:models:${hours}:${projectId ?? ''}:${fromIso}`

  try {
    const payload = await withStatsCache(c, cacheKey, STATS_SWR, async () => {
      const rows = await getStatsModels(orgId, { projectId, from: fromIso })
      const models = rows.map((r) => ({
        provider: r.provider,
        model: r.model,
        requests: r.requests,
        totalCostUsd: parseFloat(r.total_cost_usd.toFixed(6)),
        avgLatencyMs: Math.round(r.avg_latency_ms),
        errorRate: r.error_rate,
      }))
      return { models, count: models.length }
    })
    c.header('Cache-Control', CACHE_STATS_LIVE)
    return c.json({ success: true, data: payload.models, meta: { hours, count: payload.count } })
  } catch (err) {
    console.error('[stats:models] ClickHouse query failed:', err instanceof Error ? err.message : err)
    return c.json({ error: 'Failed to fetch model stats' }, 500)
  }
})

// GET /api/v1/stats/timeseries
statsRouter.get('/timeseries', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const projectId = c.req.query('projectId')
  const from = c.req.query('from')
  const to = c.req.query('to')
  const granularity = selectGranularity(from ?? null)

  const cacheKey = `org:${orgId}:stats:timeseries:${from ?? ''}:${to ?? ''}:${projectId ?? ''}:${granularity}`

  try {
    const payload = await withStatsCache(c, cacheKey, STATS_SWR, async () => {
      const rows = await getStatsTimeseries(orgId, {
        projectId,
        from: from ?? null,
        to: to ?? null,
        granularity,
      })
      return rows.map((r) => ({
        date: r.day,
        requests: r.requests,
        cost: parseFloat(r.cost.toFixed(6)),
        tokens: r.tokens,
        errors: r.errors,
      }))
    })
    c.header('Cache-Control', CACHE_STATS_LIVE)
    return c.json({ success: true, data: payload, meta: { granularity } })
  } catch (err) {
    console.error('[stats:timeseries] ClickHouse query failed:', err instanceof Error ? err.message : err)
    return c.json({ error: 'Failed to fetch timeseries' }, 500)
  }
})

// Ordinary least squares linear regression — returns slope ($/day) and intercept.
function olsRegression(ys: number[]): { slope: number; intercept: number } {
  const n = ys.length
  if (n < 2) return { slope: 0, intercept: ys[0] ?? 0 }
  // x = day index 1..n
  const sumX = (n * (n + 1)) / 2
  const sumX2 = (n * (n + 1) * (2 * n + 1)) / 6
  const sumY = ys.reduce((s, v) => s + v, 0)
  const sumXY = ys.reduce((s, v, i) => s + v * (i + 1), 0)
  const denom = n * sumX2 - sumX * sumX
  if (denom === 0) return { slope: 0, intercept: sumY / n }
  const slope = (n * sumXY - sumX * sumY) / denom
  const intercept = (sumY - slope * sumX) / n
  return { slope, intercept }
}

// GET /api/v1/stats/spend-forecast — monthly spend forecast via linear regression
statsRouter.get('/spend-forecast', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const projectId = c.req.query('projectId')

  const now = new Date()
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth()
  const dayOfMonth = now.getUTCDate()
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const monthStart = new Date(Date.UTC(year, month, 1)).toISOString()

  // The downstream math (regression, projection) is pure and cheap — only the
  // ClickHouse timeseries lookup is worth caching. monthStart is constant for
  // the calendar month so a single cache key serves the whole day.
  const cacheKey = `org:${orgId}:stats:spend-forecast-rows:${monthStart}:${projectId ?? ''}`

  let rows: TimeseriesRow[]
  try {
    rows = await withStatsCache(c, cacheKey, STATS_SWR_SLOW, () =>
      getStatsTimeseries(orgId, {
        projectId,
        from: monthStart,
        to: null,
        granularity: 'day',
      }),
    )
  } catch (err) {
    console.error('[stats:spend-forecast] ClickHouse query failed:', err instanceof Error ? err.message : err)
    return c.json({ error: 'Failed to fetch spend forecast' }, 500)
  }

  const costByDate = new Map<string, number>()
  for (const r of rows) {
    costByDate.set(r.day.slice(0, 10), parseFloat(r.cost.toFixed(6)))
  }

  // Build actual daily cost array (day 1 → today), filling missing days with 0
  const actualCosts: number[] = []
  for (let d = 1; d <= dayOfMonth; d++) {
    const key = new Date(Date.UTC(year, month, d)).toISOString().slice(0, 10)
    actualCosts.push(costByDate.get(key) ?? 0)
  }

  const monthToDate = actualCosts.reduce((s, v) => s + v, 0)
  const dailyAvgUsd = dayOfMonth > 0 ? monthToDate / dayOfMonth : 0

  // Weekly delta (this week vs previous week total spend)
  const thisWeekCost = actualCosts.slice(-7).reduce((s, v) => s + v, 0)
  const prevWeekCost = actualCosts.slice(-14, -7).reduce((s, v) => s + v, 0)
  const weeklyDeltaPct =
    prevWeekCost > 0
      ? parseFloat(((thisWeekCost - prevWeekCost) / prevWeekCost * 100).toFixed(1))
      : null

  // Linear regression over all actual days — captures trend, not just flat average
  const { slope, intercept } = olsRegression(actualCosts)

  // Project remaining days using the regression line.
  // Allow negative contributions so declining trends reduce the forecast;
  // clamp only to avoid a negative total month-end figure.
  let projectedSum = 0
  for (let d = dayOfMonth + 1; d <= daysInMonth; d++) {
    projectedSum += slope * d + intercept
  }
  projectedSum = Math.max(0, projectedSum)
  const projectedMonthEnd = monthToDate + projectedSum

  // Full month timeseries: actual for past/today, regression line for today+future
  const timeseries: { date: string; actual: number | null; projected: number | null }[] = []
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(Date.UTC(year, month, d)).toISOString().slice(0, 10)
    const regressionValue = parseFloat(Math.max(0, slope * d + intercept).toFixed(6))
    timeseries.push({
      date,
      actual: d <= dayOfMonth ? (costByDate.get(date) ?? 0) : null,
      projected: d >= dayOfMonth ? regressionValue : null,
    })
  }

  c.header('Cache-Control', CACHE_STATS_FORECAST)
  return c.json({
    success: true,
    data: {
      monthToDate: parseFloat(monthToDate.toFixed(4)),
      dayOfMonth,
      daysInMonth,
      dailyAvgUsd: parseFloat(dailyAvgUsd.toFixed(4)),
      projectedMonthEndUsd: parseFloat(projectedMonthEnd.toFixed(4)),
      weeklyDeltaPct,
      // Positive = spend trending up $/day, negative = trending down
      dailyTrendUsd: parseFloat(slope.toFixed(4)),
      timeseries,
    },
  })
})

/**
 * GET /api/v1/stats/latency?hours=24
 *
 * Returns proxy overhead percentiles computed in-memory from the last N hours.
 * proxy_overhead_ms = pre-fetch processing time (auth + decryption + parsing).
 * Target: p95 < 50ms. latency_ms = provider upstream fetch time.
 *
 * Rows without proxy_overhead_ms (logged before this column was added)
 * are excluded from the overhead percentiles but counted in the total.
 */
statsRouter.get('/latency', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const hours = parseClampedFloat(c.req.query('hours'), 24, 0.001, 24 * 30)

  try {
    // ClickHouse's quantile() runs in-database — no need to pull 5k rows
    // back to JS and sort. Sub-100ms even at 10M+ row scale.
    const r = await getLatencyPercentiles(orgId, hours)
    c.header('Cache-Control', CACHE_STATS_LIVE)
    return c.json({
      success: true,
      data: {
        sampleCount: r.sample_count,
        overheadSampleCount: r.overhead_sample_count,
        hours,
        provider: {
          p50Ms: Math.round(r.p50_provider),
          p95Ms: Math.round(r.p95_provider),
          p99Ms: Math.round(r.p99_provider),
          avgMs: Math.round(r.avg_provider),
        },
        overhead: {
          p50Ms: Math.round(r.p50_overhead),
          p95Ms: Math.round(r.p95_overhead),
          p99Ms: Math.round(r.p99_overhead),
          avgMs: Math.round(r.avg_overhead),
          targetP95Ms: 50,
          withinSla: r.p95_overhead <= 50 || r.overhead_sample_count === 0,
        },
      },
    })
  } catch (err) {
    console.error('[stats:latency] ClickHouse query failed:', err instanceof Error ? err.message : err)
    return c.json({ error: 'Failed to fetch latency data' }, 500)
  }
})
