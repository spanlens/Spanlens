import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../middleware/authJwt.js'
import { parsePageLimit } from '../lib/params.js'
import { getUserAnalytics, type UserAnalyticsRow } from '../lib/stats-queries.js'
import { requestsScope, selectRequests } from '../lib/requests-query.js'

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
  const sortByRaw = c.req.query('sortBy') ?? 'cost'
  const sortDirRaw = c.req.query('sortDir') ?? 'desc'
  const sortBy: 'cost' | 'requests' | 'tokens' | 'last_seen' =
    sortByRaw === 'requests' || sortByRaw === 'tokens' || sortByRaw === 'last_seen'
      ? sortByRaw
      : 'cost'
  const sortDir: 'asc' | 'desc' = sortDirRaw === 'asc' ? 'asc' : 'desc'
  const { page, limit, offset } = parsePageLimit(c.req.query('page'), c.req.query('limit'))

  let rows: UserAnalyticsRow[]
  try {
    rows = await getUserAnalytics(orgId, {
      projectId, search, from, to, sortBy, sortDir, limit, offset,
    })
  } catch (err) {
    console.error('[users] ClickHouse query failed:', err instanceof Error ? err.message : err)
    return c.json({ error: 'Failed to fetch user analytics' }, 500)
  }

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

  // Aggregate query reuses the same helper with a pre-narrowed search.
  let aggRows: UserAnalyticsRow[]
  try {
    aggRows = await getUserAnalytics(orgId, {
      projectId, search: userId, from, to,
      sortBy: 'cost', sortDir: 'desc',
      limit: 50, offset: 0,
    })
  } catch (err) {
    console.error('[users:detail] ClickHouse query failed:', err instanceof Error ? err.message : err)
    return c.json({ error: 'Failed to fetch user analytics' }, 500)
  }
  const agg = aggRows.find((r) => r.user_id === userId) ?? null
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

  // Recent 50 requests for this user — ClickHouse via selectRequests.
  interface RecentRow {
    id: string
    provider: string
    model: string
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    cache_read_tokens: number
    cache_write_tokens: number
    cost_usd: string | number | null
    latency_ms: number
    status_code: number
    error_message: string | null
    session_id: string | null
    created_at: string
  }
  const recentFilters: string[] = ['user_id = {userId:String}']
  const recentParams: Record<string, unknown> = { userId }
  if (projectId) {
    recentFilters.push('project_id = {projectId:UUID}')
    recentParams['projectId'] = projectId
  }
  if (from) {
    recentFilters.push('created_at >= parseDateTime64BestEffort({fromTs:String})')
    recentParams['fromTs'] = from.replace('T', ' ').replace('Z', '')
  }
  if (to) {
    recentFilters.push('created_at <= parseDateTime64BestEffort({toTs:String})')
    recentParams['toTs'] = to.replace('T', ' ').replace('Z', '')
  }

  let recent: Array<Omit<RecentRow, 'cost_usd'> & { cost_usd: number | null }>
  try {
    const scope = await requestsScope(orgId)
    const rows = await selectRequests<RecentRow>({
      scope,
      select:
        'id, provider, model, prompt_tokens, completion_tokens, total_tokens, ' +
        'cache_read_tokens, cache_write_tokens, cost_usd, latency_ms, ' +
        'status_code, error_message, session_id, created_at',
      filters: recentFilters.join(' AND '),
      orderBy: 'created_at DESC',
      limit: 50,
      params: recentParams,
    })
    recent = rows.map((r) => ({
      ...r,
      cost_usd: r.cost_usd == null ? null : Number(r.cost_usd),
    }))
  } catch (err) {
    console.error('[users:detail] recent error:', err instanceof Error ? err.message : err)
    return c.json({ error: 'Failed to fetch recent requests' }, 500)
  }

  return c.json({
    success: true,
    data: { ...agg, recent_requests: recent ?? [] },
  })
})
