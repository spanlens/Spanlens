import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../middleware/authJwt.js'
import { supabaseAdmin } from '../lib/db.js'

export const tracesRouter = new Hono<JwtContext>()

tracesRouter.use('*', authJwt)

// GET /api/v1/traces — list traces with filters + pagination
// Query params: projectId, status, from, to, page, limit
tracesRouter.get('/', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const projectId = c.req.query('projectId')
  const status = c.req.query('status')
  const from = c.req.query('from')
  const to = c.req.query('to')
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10))
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') ?? '50', 10)))
  const offset = (page - 1) * limit

  let query = supabaseAdmin
    .from('traces')
    .select(
      'id, project_id, name, status, started_at, ended_at, duration_ms, span_count, total_tokens, total_cost_usd, error_message, created_at',
      { count: 'exact' },
    )
    .eq('organization_id', orgId)
    .order('started_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (projectId) query = query.eq('project_id', projectId)
  if (status) query = query.eq('status', status)
  if (from) query = query.gte('started_at', from)
  if (to) query = query.lte('started_at', to)

  const { data, error, count } = await query
  if (error) return c.json({ error: 'Failed to fetch traces' }, 500)

  return c.json({
    success: true,
    data: data ?? [],
    meta: { total: count ?? 0, page, limit },
  })
})

// GET /api/v1/traces/:id — trace detail with all spans (tree structure)
tracesRouter.get('/:id', async (c) => {
  const traceId = c.req.param('id')
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const { data: trace, error: traceErr } = await supabaseAdmin
    .from('traces')
    .select('*')
    .eq('id', traceId)
    .eq('organization_id', orgId)
    .single()

  if (traceErr || !trace) return c.json({ error: 'Trace not found' }, 404)

  const { data: spans, error: spansErr } = await supabaseAdmin
    .from('spans')
    .select(
      'id, parent_span_id, name, span_type, status, started_at, ended_at, duration_ms, input, output, metadata, error_message, request_id, prompt_tokens, completion_tokens, total_tokens, cost_usd',
    )
    .eq('trace_id', traceId)
    .order('started_at', { ascending: true })

  if (spansErr) return c.json({ error: 'Failed to fetch spans' }, 500)

  return c.json({
    success: true,
    data: { ...trace, spans: spans ?? [] },
  })
})
