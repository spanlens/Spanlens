import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../middleware/authJwt.js'
import { supabaseAdmin } from '../lib/db.js'

export const statsRouter = new Hono<JwtContext>()

statsRouter.use('*', authJwt)

async function getOrgId(userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('organizations')
    .select('id')
    .eq('owner_id', userId)
    .single()
  return data?.id ?? null
}

// GET /api/v1/stats/overview — total requests, cost, tokens for dashboard cards
// Query params: projectId, from, to (ISO date strings)
statsRouter.get('/overview', async (c) => {
  const userId = c.get('userId')
  const orgId = await getOrgId(userId)
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const projectId = c.req.query('projectId')
  const from = c.req.query('from')
  const to   = c.req.query('to')

  let query = supabaseAdmin
    .from('requests')
    .select('cost_usd, total_tokens, prompt_tokens, completion_tokens, status_code, latency_ms')
    .eq('organization_id', orgId)

  if (projectId) query = query.eq('project_id', projectId)
  if (from)      query = query.gte('created_at', from)
  if (to)        query = query.lte('created_at', to)

  const { data, error } = await query
  if (error) return c.json({ error: 'Failed to fetch stats' }, 500)

  const rows = data ?? []
  const totalRequests    = rows.length
  const successRequests  = rows.filter((r) => (r.status_code as number) < 400).length
  const errorRequests    = totalRequests - successRequests
  const totalCostUsd     = rows.reduce((s, r) => s + ((r.cost_usd as number | null) ?? 0), 0)
  const totalTokens      = rows.reduce((s, r) => s + ((r.total_tokens as number) ?? 0), 0)
  const promptTokens     = rows.reduce((s, r) => s + ((r.prompt_tokens as number) ?? 0), 0)
  const completionTokens = rows.reduce((s, r) => s + ((r.completion_tokens as number) ?? 0), 0)
  const avgLatencyMs     =
    totalRequests > 0
      ? rows.reduce((s, r) => s + ((r.latency_ms as number) ?? 0), 0) / totalRequests
      : 0

  return c.json({
    success: true,
    data: {
      totalRequests,
      successRequests,
      errorRequests,
      totalCostUsd: parseFloat(totalCostUsd.toFixed(6)),
      totalTokens,
      promptTokens,
      completionTokens,
      avgLatencyMs: Math.round(avgLatencyMs),
    },
  })
})

// GET /api/v1/stats/timeseries — daily aggregates for charts
// Query params: projectId, from, to, granularity (day|hour)
statsRouter.get('/timeseries', async (c) => {
  const userId = c.get('userId')
  const orgId = await getOrgId(userId)
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const projectId   = c.req.query('projectId')
  const from        = c.req.query('from') ?? new Date(Date.now() - 30 * 86400_000).toISOString()
  const to          = c.req.query('to')   ?? new Date().toISOString()

  let query = supabaseAdmin
    .from('requests')
    .select('created_at, cost_usd, total_tokens, status_code')
    .eq('organization_id', orgId)
    .gte('created_at', from)
    .lte('created_at', to)
    .order('created_at', { ascending: true })

  if (projectId) query = query.eq('project_id', projectId)

  const { data, error } = await query
  if (error) return c.json({ error: 'Failed to fetch timeseries' }, 500)

  // Aggregate by day
  const byDay = new Map<string, { requests: number; cost: number; tokens: number; errors: number }>()
  for (const row of data ?? []) {
    const day = (row.created_at as string).slice(0, 10)
    const existing = byDay.get(day) ?? { requests: 0, cost: 0, tokens: 0, errors: 0 }
    byDay.set(day, {
      requests: existing.requests + 1,
      cost: existing.cost + ((row.cost_usd as number | null) ?? 0),
      tokens: existing.tokens + ((row.total_tokens as number) ?? 0),
      errors: existing.errors + ((row.status_code as number) >= 400 ? 1 : 0),
    })
  }

  const series = Array.from(byDay.entries()).map(([date, v]) => ({
    date,
    requests: v.requests,
    cost: parseFloat(v.cost.toFixed(6)),
    tokens: v.tokens,
    errors: v.errors,
  }))

  return c.json({ success: true, data: series })
})
