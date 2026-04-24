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

// GET /api/v1/stats/overview
statsRouter.get('/overview', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const projectId = c.req.query('projectId')
  const from = c.req.query('from')
  const to = c.req.query('to')

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
  const totalCostUsd = Number(row?.total_cost_usd ?? 0)
  const avgLatencyMs = Number(row?.avg_latency_ms ?? 0)

  return c.json({
    success: true,
    data: {
      totalRequests: Number(row?.total_requests ?? 0),
      successRequests: Number(row?.success_requests ?? 0),
      errorRequests: Number(row?.error_requests ?? 0),
      totalCostUsd: parseFloat(totalCostUsd.toFixed(6)),
      totalTokens: Number(row?.total_tokens ?? 0),
      promptTokens: Number(row?.prompt_tokens ?? 0),
      completionTokens: Number(row?.completion_tokens ?? 0),
      avgLatencyMs: Math.round(avgLatencyMs),
    },
  })
})

interface TimeseriesRow {
  day: string
  requests: number
  cost: number
  tokens: number
  errors: number
}

// GET /api/v1/stats/models?hours=24 — per-model breakdown, sorted by cost desc
// Aggregates in-memory over the window. Bounded by the 24h default.
statsRouter.get('/models', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const hoursRaw = Number(c.req.query('hours'))
  const hours = Number.isFinite(hoursRaw) && hoursRaw > 0 ? Math.min(hoursRaw, 24 * 30) : 24
  const projectId = c.req.query('projectId')
  const sinceIso = new Date(Date.now() - hours * 3_600_000).toISOString()

  let query = supabaseAdmin
    .from('requests')
    .select('provider, model, cost_usd, latency_ms, status_code')
    .eq('organization_id', orgId)
    .gte('created_at', sinceIso)

  if (projectId) query = query.eq('project_id', projectId)

  const { data, error } = await query

  if (error) return c.json({ error: 'Failed to fetch model stats' }, 500)

  interface Agg { requests: number; cost: number; latency: number; errors: number }
  const byKey = new Map<string, Agg & { provider: string; model: string }>()

  for (const r of (data ?? []) as Array<{
    provider: string
    model: string
    cost_usd: number | null
    latency_ms: number | null
    status_code: number | null
  }>) {
    const key = `${r.provider}|${r.model}`
    const agg = byKey.get(key) ?? { provider: r.provider, model: r.model, requests: 0, cost: 0, latency: 0, errors: 0 }
    agg.requests += 1
    agg.cost += r.cost_usd ?? 0
    agg.latency += r.latency_ms ?? 0
    if (r.status_code !== null && r.status_code >= 400) agg.errors += 1
    byKey.set(key, agg)
  }

  const models = Array.from(byKey.values())
    .map((a) => ({
      provider: a.provider,
      model: a.model,
      requests: a.requests,
      totalCostUsd: parseFloat(a.cost.toFixed(6)),
      avgLatencyMs: a.requests > 0 ? Math.round(a.latency / a.requests) : 0,
      errorRate: a.requests > 0 ? a.errors / a.requests : 0,
    }))
    .sort((x, y) => y.totalCostUsd - x.totalCostUsd)

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
