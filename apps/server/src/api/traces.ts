import { Hono } from 'hono'
import type { JwtContext } from '../middleware/authJwt.js'
import { authJwtOrApiKey } from '../middleware/authJwtOrApiKey.js'
import { supabaseAdmin } from '../lib/db.js'
import { computeCriticalPath } from '../lib/critical-path.js'
import { parsePageLimit } from '../lib/params.js'
import { useEventsForRequests } from '../lib/feature-flags.js'
import {
  listTracesFromEvents,
  getTraceWithSpansFromEvents,
} from '../lib/traces-events-queries.js'
import { ApiError } from '../lib/errors.js'

export const tracesRouter = new Hono<JwtContext>()

tracesRouter.use('*', authJwtOrApiKey)

// GET /api/v1/traces — list traces with filters + pagination
// Query params: projectId, status, from, to, q (name or trace-id substring),
// page, limit
tracesRouter.get('/', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  const projectId = c.req.query('projectId')
  const status = c.req.query('status')
  const from = c.req.query('from')
  const to = c.req.query('to')
  // `q` does a case-insensitive substring search over both `name` and `id`.
  // Without this the /traces page filtered client-side over the current 50-row
  // page only, which silently dropped matches living on other pages.
  const q = c.req.query('q')?.trim()
  const { page, limit, offset } = parsePageLimit(c.req.query('page'), c.req.query('limit'))

  // Phase 5.1 PR-7b — when the read switch is on, read from the events
  // table via traces_view/spans_view. Catch-and-fall-back to Postgres
  // so a regression on the events side degrades to "same behaviour as
  // before Stage 3" rather than 500.
  if (useEventsForRequests) {
    try {
      const result = await listTracesFromEvents({
        organizationId: orgId,
        projectId,
        status,
        from,
        to,
        q,
        limit,
        offset,
      })
      return c.json({
        success: true,
        data: result.rows,
        meta: { total: result.total, page, limit },
      })
    } catch (eventsErr) {
      console.error('[traces:list] events path failed, falling back to Postgres:', {
        message: eventsErr instanceof Error ? eventsErr.message : String(eventsErr),
        orgId,
      })
      // fall through to the Postgres path below
    }
  }

  // `count: 'planned'` uses the Postgres query planner's row estimate instead
  // of forcing a COUNT(*) scan. Saves -200~500ms per request on the traces
  // table, which is fine here because the dashboard only renders the total as
  // a display number ("N of M traces") — there's no pagination logic that
  // gates "Next" on the exact total. Plan: docs/plans/dashboard-load-perf-2026-05.md §7.1.
  let query = supabaseAdmin
    .from('traces')
    .select(
      'id, project_id, name, status, started_at, ended_at, duration_ms, span_count, total_tokens, total_cost_usd, error_message, created_at',
      { count: 'planned' },
    )
    .eq('organization_id', orgId)
    .order('started_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (projectId) query = query.eq('project_id', projectId)
  if (status) query = query.eq('status', status)
  if (from) query = query.gte('started_at', from)
  if (to) query = query.lte('started_at', to)
  if (q) {
    // `id` is a UUID, which PostgreSQL refuses to match with LIKE/ILIKE — so
    // we ilike on `name` (text) and `external_trace_id` (text, OTLP hex)
    // and only fall back to `id.eq` when the query looks like a full UUID.
    // Short UUID-prefix searches aren't supported here; the user can paste
    // a full ID or jump in via /traces/<id> directly.
    const escaped = q.replace(/[%,]/g, '\\$&')
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(q)
    const clauses = [
      `name.ilike.%${escaped}%`,
      `external_trace_id.ilike.%${escaped}%`,
      ...(isUuid ? [`id.eq.${q}`] : []),
    ]
    query = query.or(clauses.join(','))
  }

  const { data, error, count } = await query
  if (error) throw new ApiError('INTERNAL_ERROR', 'Failed to fetch traces')

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
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  if (useEventsForRequests) {
    try {
      const { trace, spans } = await getTraceWithSpansFromEvents(traceId, orgId)
      if (!trace) throw new ApiError('NOT_FOUND', 'Trace not found')
      const criticalSpanIds = computeCriticalPath(spans)
      return c.json({
        success: true,
        data: { ...trace, spans, critical_span_ids: criticalSpanIds },
      })
    } catch (eventsErr) {
      console.error('[traces:detail] events path failed, falling back to Postgres:', {
        message: eventsErr instanceof Error ? eventsErr.message : String(eventsErr),
        traceId,
        orgId,
      })
      // fall through to the Postgres path below
    }
  }

  const { data: trace, error: traceErr } = await supabaseAdmin
    .from('traces')
    .select('*')
    .eq('id', traceId)
    .eq('organization_id', orgId)
    .single()

  if (traceErr || !trace) throw new ApiError('NOT_FOUND', 'Trace not found')

  const { data: spans, error: spansErr } = await supabaseAdmin
    .from('spans')
    .select(
      'id, parent_span_id, name, span_type, status, started_at, ended_at, duration_ms, input, output, metadata, error_message, request_id, prompt_tokens, completion_tokens, total_tokens, cost_usd',
    )
    .eq('trace_id', traceId)
    .order('started_at', { ascending: true })

  if (spansErr) throw new ApiError('INTERNAL_ERROR', 'Failed to fetch spans')

  const criticalSpanIds = computeCriticalPath(spans ?? [])

  return c.json({
    success: true,
    data: { ...trace, spans: spans ?? [], critical_span_ids: criticalSpanIds },
  })
})
