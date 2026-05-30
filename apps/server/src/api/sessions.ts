import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../middleware/authJwt.js'
import { parsePageLimit } from '../lib/params.js'
import { getSessionAnalytics, type SessionAnalyticsRow } from '../lib/stats-queries.js'
import { requestsScope, selectRequests } from '../lib/requests-query.js'
import { fromClickhouseTimestamp } from '../lib/clickhouse.js'

export const sessionsRouter = new Hono<JwtContext>()

sessionsRouter.use('*', authJwt)

// Max conversation turns returned for a single session detail. A session is a
// conversation thread, so this is generous; longer threads are truncated with a
// flag so the UI can tell the user some turns are hidden.
const MAX_TURNS = 200

function parseJsonColumn(value: string | null | undefined, fallback: unknown): unknown {
  if (value == null || value === '') return fallback
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/sessions — aggregate per-session usage
//
// Returns one row per distinct (organization_id, session_id) — the session IDs
// the customer attaches via x-spanlens-session. Sorted by last activity by
// default (most recent conversations first).
//
// Query params:
//   • projectId — filter to one project
//   • userId    — filter to one end-user's sessions
//   • from / to — ISO date strings; defaults to last 30 days (client-supplied)
//   • search    — substring match on session_id (icontains)
//   • sortBy    — 'cost' | 'requests' | 'tokens' | 'last_seen' | 'latency'
//   • sortDir   — 'asc' | 'desc' (default: desc)
//   • page / limit — pagination (limit ≤ 100, default 50)
// ─────────────────────────────────────────────────────────────────────────────
sessionsRouter.get('/', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const projectId = c.req.query('projectId') ?? null
  const userId    = c.req.query('userId') ?? null
  const search    = c.req.query('search') ?? null
  const from      = c.req.query('from') ?? null
  const to        = c.req.query('to') ?? null
  const sortByRaw  = c.req.query('sortBy') ?? 'last_seen'
  const sortDirRaw = c.req.query('sortDir') ?? 'desc'
  const sortBy: 'cost' | 'requests' | 'tokens' | 'last_seen' | 'latency' =
    sortByRaw === 'cost' || sortByRaw === 'requests' || sortByRaw === 'tokens' || sortByRaw === 'latency'
      ? sortByRaw
      : 'last_seen'
  const sortDir: 'asc' | 'desc' = sortDirRaw === 'asc' ? 'asc' : 'desc'
  const { page, limit, offset } = parsePageLimit(c.req.query('page'), c.req.query('limit'))

  let rows: SessionAnalyticsRow[]
  try {
    rows = await getSessionAnalytics(orgId, {
      projectId, userId, search, from, to, sortBy, sortDir, limit, offset,
    })
  } catch (err) {
    console.error('[sessions] ClickHouse query failed:', err instanceof Error ? err.message : err)
    return c.json({ error: 'Failed to fetch session analytics' }, 500)
  }

  const totalCount = rows[0]?.total_count ?? 0

  return c.json({
    success: true,
    // Convert ClickHouse DateTime64 → ISO UTC so the client's relative-time
    // formatting is correct for non-UTC users (gotcha #18).
    data: rows.map(({ total_count: _omit, first_seen, last_seen, ...rest }) => ({
      ...rest,
      first_seen: fromClickhouseTimestamp(first_seen) ?? first_seen,
      last_seen: fromClickhouseTimestamp(last_seen) ?? last_seen,
    })),
    meta: { total: totalCount, page, limit },
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/sessions/:sessionId — single session detail
//
// Aggregate totals + the ordered conversation turns (each request in the
// session, oldest first) with parsed request/response bodies so the dashboard
// can render the multi-turn conversation timeline.
// ─────────────────────────────────────────────────────────────────────────────
sessionsRouter.get('/:sessionId', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)
  const sessionId = c.req.param('sessionId')

  const projectId = c.req.query('projectId') ?? null
  const from      = c.req.query('from') ?? null
  const to        = c.req.query('to') ?? null

  // Aggregate reuses the list helper with a pre-narrowed search, then we pick
  // the exact session_id match (substring search can return neighbors).
  let aggRows: SessionAnalyticsRow[]
  try {
    aggRows = await getSessionAnalytics(orgId, {
      projectId, search: sessionId, from, to,
      sortBy: 'last_seen', sortDir: 'desc',
      limit: 50, offset: 0,
    })
  } catch (err) {
    console.error('[sessions:detail] ClickHouse query failed:', err instanceof Error ? err.message : err)
    return c.json({ error: 'Failed to fetch session analytics' }, 500)
  }
  const agg = aggRows.find((r) => r.session_id === sessionId) ?? null
  if (!agg) {
    return c.json({
      success: true,
      data: {
        session_id: sessionId,
        user_id: null,
        total_requests: 0,
        total_tokens: 0,
        total_cost_usd: 0,
        avg_latency_ms: null,
        first_seen: null,
        last_seen: null,
        error_requests: 0,
        distinct_models: 0,
        turns: [],
        turns_truncated: false,
      },
    })
  }

  // Conversation turns — ordered oldest-first so the thread reads top-to-bottom.
  interface TurnRow {
    id: string
    provider: string
    model: string
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    cost_usd: string | number | null
    latency_ms: number
    status_code: number
    error_message: string | null
    trace_id: string | null
    user_id: string | null
    request_body: string
    response_body: string
    created_at: string
  }
  const turnFilters: string[] = ['session_id = {sessionId:String}']
  const turnParams: Record<string, unknown> = { sessionId }
  if (projectId) {
    turnFilters.push('project_id = {projectId:UUID}')
    turnParams['projectId'] = projectId
  }
  if (from) {
    turnFilters.push('created_at >= parseDateTime64BestEffort({fromTs:String})')
    turnParams['fromTs'] = from.replace('T', ' ').replace('Z', '')
  }
  if (to) {
    turnFilters.push('created_at <= parseDateTime64BestEffort({toTs:String})')
    turnParams['toTs'] = to.replace('T', ' ').replace('Z', '')
  }

  let turns: Array<Record<string, unknown>>
  try {
    const scope = await requestsScope(orgId)
    // Fetch one extra row to detect truncation without a second COUNT query.
    const rows = await selectRequests<TurnRow>({
      scope,
      select:
        'id, provider, model, prompt_tokens, completion_tokens, total_tokens, ' +
        'cost_usd, latency_ms, status_code, error_message, trace_id, user_id, ' +
        'request_body, response_body, created_at',
      filters: turnFilters.join(' AND '),
      orderBy: 'created_at ASC',
      limit: MAX_TURNS + 1,
      params: turnParams,
    })
    const truncated = rows.length > MAX_TURNS
    turns = rows.slice(0, MAX_TURNS).map((r) => ({
      id: r.id,
      provider: r.provider,
      model: r.model,
      prompt_tokens: r.prompt_tokens,
      completion_tokens: r.completion_tokens,
      total_tokens: r.total_tokens,
      cost_usd: r.cost_usd == null ? null : Number(r.cost_usd),
      latency_ms: r.latency_ms,
      status_code: r.status_code,
      error_message: r.error_message,
      trace_id: r.trace_id,
      user_id: r.user_id,
      created_at: fromClickhouseTimestamp(r.created_at) ?? r.created_at,
      request_body: parseJsonColumn(r.request_body, null),
      response_body: parseJsonColumn(r.response_body, null),
    }))

    return c.json({
      success: true,
      data: {
        session_id: agg.session_id,
        user_id: agg.user_id,
        total_requests: agg.total_requests,
        total_tokens: agg.total_tokens,
        total_cost_usd: agg.total_cost_usd,
        avg_latency_ms: agg.avg_latency_ms,
        first_seen: fromClickhouseTimestamp(agg.first_seen) ?? agg.first_seen,
        last_seen: fromClickhouseTimestamp(agg.last_seen) ?? agg.last_seen,
        error_requests: agg.error_requests,
        distinct_models: agg.distinct_models,
        turns,
        turns_truncated: truncated,
      },
    })
  } catch (err) {
    console.error('[sessions:detail] turns error:', err instanceof Error ? err.message : err)
    return c.json({ error: 'Failed to fetch session turns' }, 500)
  }
})
