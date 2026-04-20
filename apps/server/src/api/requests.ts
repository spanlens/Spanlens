import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../middleware/authJwt.js'
import { supabaseAdmin } from '../lib/db.js'

export const requestsRouter = new Hono<JwtContext>()

requestsRouter.use('*', authJwt)

async function getOrgId(userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('organizations')
    .select('id')
    .eq('owner_id', userId)
    .single()
  return data?.id ?? null
}

// GET /api/v1/requests — list requests with optional filters + pagination
// Query params: projectId, provider, model, status, from, to, page, limit
requestsRouter.get('/', async (c) => {
  const userId = c.get('userId')
  const orgId = await getOrgId(userId)
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const projectId = c.req.query('projectId')
  const provider   = c.req.query('provider')
  const model      = c.req.query('model')
  const from       = c.req.query('from')     // ISO date string
  const to         = c.req.query('to')
  const page       = Math.max(1, parseInt(c.req.query('page') ?? '1', 10))
  const limit      = Math.min(100, Math.max(1, parseInt(c.req.query('limit') ?? '50', 10)))
  const offset     = (page - 1) * limit

  let query = supabaseAdmin
    .from('requests')
    .select(
      'id, project_id, provider, model, prompt_tokens, completion_tokens, total_tokens, cost_usd, latency_ms, status_code, error_message, trace_id, span_id, created_at',
      { count: 'exact' },
    )
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (projectId) query = query.eq('project_id', projectId)
  if (provider)  query = query.eq('provider', provider)
  if (model)     query = query.eq('model', model)
  if (from)      query = query.gte('created_at', from)
  if (to)        query = query.lte('created_at', to)

  const { data, error, count } = await query
  if (error) return c.json({ error: 'Failed to fetch requests' }, 500)

  return c.json({
    success: true,
    data: data ?? [],
    meta: { total: count ?? 0, page, limit },
  })
})

// GET /api/v1/requests/:id — get full request detail including bodies
requestsRouter.get('/:id', async (c) => {
  const userId = c.get('userId')
  const requestId = c.req.param('id')
  const orgId = await getOrgId(userId)
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const { data, error } = await supabaseAdmin
    .from('requests')
    .select('*')
    .eq('id', requestId)
    .eq('organization_id', orgId)
    .single()

  if (error || !data) return c.json({ error: 'Request not found' }, 404)

  return c.json({ success: true, data })
})
