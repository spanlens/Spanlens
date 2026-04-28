import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../middleware/authJwt.js'
import { supabaseAdmin } from '../lib/db.js'

/**
 * Stats endpoints — SQL-aggregated server-side.
 *
 * Earlier implementation SELECT'd the full set of matching rows and reduced
 * in JS. That works at 10 rows; at 10K+ it becomes the hottest path on the
 * dashboard. Both endpoints now call stored functions (stats_overview /
 * stats_timeseries) that compute the sums/filters with Postgres's native
 * aggregation, returning a single row (overview) or one row per day
 * (timeseries). Typical p95 drops from seconds to sub-100ms.
 *
 * The RPC functions + composite index on (organization_id, created_at DESC)
 * ship in migration 20260422153000_stats_and_security_aggregation_fns.sql.
 */

export const statsRouter = new Hono<JwtContext>()

statsRouter.use('*', authJwt)

interface OverviewRow {
  total_requests: number
  success_requests: number
  error_requests: number
  total_cost_usd: number
  total_tokens: number
  prompt_tokens: number
  completion_tokens: number
  avg_latency_ms: number
}

function pctDelta(current: number, previous: number): number | null {
  if (previous === 0) return null
  return parseFloat(((current - previous) / previous * 100).toFixed(1))
}

function rowToOverview(row: OverviewRow | undefined) {
  const totalCostUsd = Number(row?.total_cost_usd ?? 0)
  const avgLatencyMs = Number(row?.avg_latency_ms ?? 0)
  const totalRequests = Number(row?.total_requests ?? 0)
  const errorRequests = Number(row?.error_requests ?? 0)
  return {
    totalRequests,
    successRequests: Number(row?.success_requests ?? 0),
    errorRequests,
    totalCostUsd: parseFloat(totalCostUsd.toFixed(6)),
    totalTokens: Number(row?.total_tokens ?? 0),
    promptTokens: Number(row?.prompt_tokens ?? 0),
    completionTokens: Number(row?.completion_tokens ?? 0),
    avgLatencyMs: Math.round(avgLatencyMs),
    errorRate: totalRequests > 0 ? errorRequests / totalRequests : 0,
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

  if (compare) {
    // Compute previous period of equal duration, run both in parallel.
    const nowMs = Date.now()
    const toMs = to ? new Date(to).getTime() : nowMs
    const fromMs = from ? new Date(from).getTime() : toMs - 30 * 24 * 3_600_000
    const duration = toMs - fromMs
    const prevTo = new Date(fromMs).toISOString()
    const prevFrom = new Date(fromMs - duration).toISOString()

    const [curr, prev] = await Promise.all([
      supabaseAdmin.rpc('stats_overview', {
        p_org_id: orgId,
        p_project_id: projectId ?? null,
        p_from: from ?? null,
        p_to: to ?? null,
      }),
      supabaseAdmin.rpc('stats_overview', {
        p_org_id: orgId,
        p_project_id: projectId ?? null,
        p_from: prevFrom,
        p_to: prevTo,
      }),
    ])

    if (curr.error || prev.error) return c.json({ error: 'Failed to fetch stats' }, 500)

    const currRow = rowToOverview((curr.data as OverviewRow[] | null)?.[0])
    const prevRow = rowToOverview((prev.data as OverviewRow[] | null)?.[0])

    return c.json({
      success: true,
      data: {
        ...currRow,
        requestsDelta: pctDelta(currRow.totalRequests, prevRow.totalRequests),
        costDelta: pctDelta(currRow.totalCostUsd, prevRow.totalCostUsd),
        latencyDelta: pctDelta(currRow.avgLatencyMs, prevRow.avgLatencyMs),
        errorRateDelta: pctDelta(currRow.errorRate, prevRow.errorRate),
      },
    })
  }

  const { data, error } = await supabaseAdmin.rpc('stats_overview', {
    p_org_id: orgId,
    p_project_id: projectId ?? null,
    p_from: from ?? null,
    p_to: to ?? null,
  })

  if (error) return c.json({ error: 'Failed to fetch stats' }, 500)

  // RPC returns TABLE — supabase-js exposes it as an array. We only asked for
  // aggregates so it's always length 1 (even when zero matching rows).
  const row = (data as OverviewRow[] | null)?.[0]
  return c.json({ success: true, data: rowToOverview(row) })
})

interface TimeseriesRow {
  day: string
  requests: number
  cost: number
  tokens: number
  errors: number
}

interface ModelsRow {
  provider: string
  model: string
  requests: number
  total_cost_usd: number
  avg_latency_ms: number
  error_rate: number
}

// GET /api/v1/stats/models?hours=24 — per-model breakdown, sorted by cost desc
statsRouter.get('/models', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const hoursRaw = Number(c.req.query('hours'))
  const hours = Number.isFinite(hoursRaw) && hoursRaw > 0 ? Math.min(hoursRaw, 24 * 30) : 24
  const projectId = c.req.query('projectId')
  const fromIso = new Date(Date.now() - hours * 3_600_000).toISOString()

  const { data, error } = await supabaseAdmin.rpc('stats_models', {
    p_org_id: orgId,
    p_project_id: projectId ?? null,
    p_from: fromIso,
    p_to: null,
  })

  if (error) return c.json({ error: 'Failed to fetch model stats' }, 500)

  const models = ((data as ModelsRow[] | null) ?? []).map((r) => ({
    provider: r.provider,
    model: r.model,
    requests: Number(r.requests),
    totalCostUsd: parseFloat(Number(r.total_cost_usd).toFixed(6)),
    avgLatencyMs: Math.round(Number(r.avg_latency_ms)),
    errorRate: Number(r.error_rate),
  }))

  return c.json({ success: true, data: models, meta: { hours, count: models.length } })
})

// GET /api/v1/stats/timeseries
statsRouter.get('/timeseries', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const projectId = c.req.query('projectId')
  const from = c.req.query('from')
  const to = c.req.query('to')

  const { data, error } = await supabaseAdmin.rpc('stats_timeseries', {
    p_org_id: orgId,
    p_project_id: projectId ?? null,
    p_from: from ?? null,
    p_to: to ?? null,
  })

  if (error) return c.json({ error: 'Failed to fetch timeseries' }, 500)

  const series = ((data as TimeseriesRow[] | null) ?? []).map((r) => ({
    date: r.day,
    requests: Number(r.requests),
    cost: parseFloat(Number(r.cost).toFixed(6)),
    tokens: Number(r.tokens),
    errors: Number(r.errors),
  }))

  return c.json({ success: true, data: series })
})

// GET /api/v1/stats/spend-forecast — monthly spend forecast based on this month's actuals
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

  const { data, error } = await supabaseAdmin.rpc('stats_timeseries', {
    p_org_id: orgId,
    p_project_id: projectId ?? null,
    p_from: monthStart,
    p_to: null,
  })

  if (error) return c.json({ error: 'Failed to fetch spend forecast' }, 500)

  const costByDate = new Map<string, number>()
  for (const r of ((data as TimeseriesRow[] | null) ?? [])) {
    costByDate.set(r.day.slice(0, 10), parseFloat(Number(r.cost).toFixed(6)))
  }

  // Actual daily costs day-1..today
  const actualCosts: number[] = []
  for (let d = 1; d <= dayOfMonth; d++) {
    const key = new Date(Date.UTC(year, month, d)).toISOString().slice(0, 10)
    actualCosts.push(costByDate.get(key) ?? 0)
  }

  const monthToDate = actualCosts.reduce((s, v) => s + v, 0)
  const last7 = actualCosts.slice(-7)
  const last7Avg = last7.length > 0 ? last7.reduce((s, v) => s + v, 0) / last7.length : 0

  const thisWeekCost = actualCosts.slice(-7).reduce((s, v) => s + v, 0)
  const prevWeekCost = actualCosts.slice(-14, -7).reduce((s, v) => s + v, 0)
  const weeklyDeltaPct =
    prevWeekCost > 0
      ? parseFloat(((thisWeekCost - prevWeekCost) / prevWeekCost * 100).toFixed(1))
      : null

  const remainingDays = daysInMonth - dayOfMonth
  const projectedMonthEnd = monthToDate + last7Avg * remainingDays

  // Full month timeseries: actual for past days, projected for future, both on today
  const timeseries: { date: string; actual: number | null; projected: number | null }[] = []
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(Date.UTC(year, month, d)).toISOString().slice(0, 10)
    const isPast = d < dayOfMonth
    const isToday = d === dayOfMonth
    const isFuture = d > dayOfMonth
    timeseries.push({
      date,
      actual: isPast || isToday ? (costByDate.get(date) ?? 0) : null,
      projected: isToday || isFuture ? parseFloat(last7Avg.toFixed(6)) : null,
    })
  }

  return c.json({
    success: true,
    data: {
      monthToDate: parseFloat(monthToDate.toFixed(4)),
      dayOfMonth,
      daysInMonth,
      dailyAvgUsd: parseFloat(last7Avg.toFixed(4)),
      projectedMonthEndUsd: parseFloat(projectedMonthEnd.toFixed(4)),
      weeklyDeltaPct,
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

  const hoursRaw = Number(c.req.query('hours'))
  const hours = Number.isFinite(hoursRaw) && hoursRaw > 0 ? Math.min(hoursRaw, 24 * 30) : 24
  const sinceIso = new Date(Date.now() - hours * 3_600_000).toISOString()

  const { data, error } = await supabaseAdmin
    .from('requests')
    .select('latency_ms, proxy_overhead_ms')
    .eq('organization_id', orgId)
    .gte('created_at', sinceIso)
    .not('latency_ms', 'is', null)
    .order('created_at', { ascending: false })
    .limit(5000)

  if (error) return c.json({ error: 'Failed to fetch latency data' }, 500)

  const rows = (data ?? []) as Array<{ latency_ms: number | null; proxy_overhead_ms: number | null }>

  const providerMs = rows.map((r) => r.latency_ms ?? 0).filter((v) => v > 0)
  const overheadMs = rows
    .filter((r) => r.proxy_overhead_ms != null)
    .map((r) => r.proxy_overhead_ms as number)

  function percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0
    const idx = Math.ceil((p / 100) * sorted.length) - 1
    return sorted[Math.min(idx, sorted.length - 1)] ?? 0
  }

  const sortedProvider = [...providerMs].sort((a, b) => a - b)
  const sortedOverhead = [...overheadMs].sort((a, b) => a - b)

  const p50Provider = percentile(sortedProvider, 50)
  const p95Provider = percentile(sortedProvider, 95)
  const p99Provider = percentile(sortedProvider, 99)
  const p50Overhead = percentile(sortedOverhead, 50)
  const p95Overhead = percentile(sortedOverhead, 95)
  const p99Overhead = percentile(sortedOverhead, 99)

  return c.json({
    success: true,
    data: {
      sampleCount: rows.length,
      overheadSampleCount: overheadMs.length,
      hours,
      provider: {
        p50Ms: Math.round(p50Provider),
        p95Ms: Math.round(p95Provider),
        p99Ms: Math.round(p99Provider),
        avgMs: providerMs.length > 0 ? Math.round(providerMs.reduce((s, v) => s + v, 0) / providerMs.length) : 0,
      },
      overhead: {
        p50Ms: Math.round(p50Overhead),
        p95Ms: Math.round(p95Overhead),
        p99Ms: Math.round(p99Overhead),
        avgMs: overheadMs.length > 0 ? Math.round(overheadMs.reduce((s, v) => s + v, 0) / overheadMs.length) : 0,
        targetP95Ms: 50,
        withinSla: p95Overhead <= 50 || overheadMs.length === 0,
      },
    },
  })
})
