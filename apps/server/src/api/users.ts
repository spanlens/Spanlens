import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../middleware/authJwt.js'
import { supabaseAdmin } from '../lib/db.js'
import { parsePageLimit } from '../lib/params.js'

export const usersRouter = new Hono<JwtContext>()

usersRouter.use('*', authJwt)

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/users — aggregate per-user usage
//
// Returns one row per distinct (organization_id, user_id) — the end-user IDs
// the customer attaches via x-spanlens-user. Sorted by total cost (highest
// spenders first) by default.
//
// Query params:
//   • projectId — filter to one project
//   • from / to — ISO date strings; defaults to last 30 days
//   • search    — substring match on user_id (icontains)
//   • sortBy    — 'cost' | 'requests' | 'tokens' | 'last_seen' (default: cost)
//   • sortDir   — 'asc' | 'desc' (default: desc)
//   • page / limit — pagination (limit ≤ 100, default 50)
// ─────────────────────────────────────────────────────────────────────────────
usersRouter.get('/', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const projectId = c.req.query('projectId') ?? null
  const search    = c.req.query('search') ?? null
  const from      = c.req.query('from') ?? null
  const to        = c.req.query('to') ?? null
  const sortBy    = c.req.query('sortBy') ?? 'cost'
  const sortDir   = c.req.query('sortDir') ?? 'desc'
  const { page, limit, offset } = parsePageLimit(c.req.query('page'), c.req.query('limit'))

  // Hand-rolled RPC — supabase-js doesn't expose GROUP BY in the table API.
  // The function lives in the migration we add below.
  const { data, error } = await supabaseAdmin.rpc('get_user_analytics', {
    p_org_id: orgId,
    p_project_id: projectId,
    p_search: search,
    p_from: from,
    p_to: to,
    p_sort_by: sortBy,
    p_sort_dir: sortDir,
    p_limit: limit,
    p_offset: offset,
  })

  if (error) {
    console.error('[users] rpc error:', error.message)
    return c.json({ error: 'Failed to fetch user analytics' }, 500)
  }

  type UserRow = {
    user_id: string
    total_requests: number
    total_tokens: number
    total_cost_usd: number | null
    avg_latency_ms: number | null
    first_seen: string
    last_seen: string
    error_requests: number
    distinct_models: number
    total_count: number
  }
  const rows = (data ?? []) as UserRow[]
  const totalCount = rows[0]?.total_count ?? 0

  return c.json({
    success: true,
    data: rows.map(({ total_count: _omit, ...rest }) => rest),
    meta: { total: totalCount, page, limit },
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/users/:userId — single user detail
//
// Aggregates + recent 50 requests for one user_id within the org. Mirrors the
// list endpoint's filter shape (projectId, from, to).
// ─────────────────────────────────────────────────────────────────────────────
usersRouter.get('/:userId', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)
  const userId = c.req.param('userId')

  const projectId = c.req.query('projectId') ?? null
  const from      = c.req.query('from') ?? null
  const to        = c.req.query('to') ?? null

  // Aggregate query reuses the same RPC with a pre-narrowed search.
  const { data: aggRows, error: aggErr } = await supabaseAdmin.rpc('get_user_analytics', {
    p_org_id: orgId,
    p_project_id: projectId,
    p_search: userId, // exact match handled below
    p_from: from,
    p_to: to,
    p_sort_by: 'cost',
    p_sort_dir: 'desc',
    p_limit: 50,
    p_offset: 0,
  })
  if (aggErr) {
    console.error('[users:detail] rpc error:', aggErr.message)
    return c.json({ error: 'Failed to fetch user analytics' }, 500)
  }

  type UserRow = {
    user_id: string
    total_requests: number
    total_tokens: number
    total_cost_usd: number | null
    avg_latency_ms: number | null
    first_seen: string
    last_seen: string
    error_requests: number
    distinct_models: number
  }
  const agg = ((aggRows as UserRow[]) ?? []).find((r) => r.user_id === userId) ?? null
  if (!agg) {
    return c.json({
      success: true,
      data: {
        user_id: userId,
        total_requests: 0,
        total_tokens: 0,
        total_cost_usd: 0,
        avg_latency_ms: null,
        first_seen: null,
        last_seen: null,
        error_requests: 0,
        distinct_models: 0,
        recent_requests: [],
      },
    })
  }

  // Recent 50 requests for this user (no rpc needed — supabase table query works)
  let recentQuery = supabaseAdmin
    .from('requests')
    .select('id, provider, model, prompt_tokens, completion_tokens, total_tokens, cache_read_tokens, cache_write_tokens, cost_usd, latency_ms, status_code, error_message, session_id, created_at')
    .eq('organization_id', orgId)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50)
  if (projectId) recentQuery = recentQuery.eq('project_id', projectId)
  if (from)      recentQuery = recentQuery.gte('created_at', from)
  if (to)        recentQuery = recentQuery.lte('created_at', to)

  const { data: recent, error: recentErr } = await recentQuery
  if (recentErr) {
    console.error('[users:detail] recent error:', recentErr.message)
    return c.json({ error: 'Failed to fetch recent requests' }, 500)
  }

  return c.json({
    success: true,
    data: { ...agg, recent_requests: recent ?? [] },
  })
})
