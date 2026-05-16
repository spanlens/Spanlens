import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../middleware/authJwt.js'
import { supabaseAdmin } from '../lib/db.js'
import { detectAnomalies } from '../lib/anomaly.js'
import { requestsScope, selectRequests } from '../lib/requests-query.js'

export const exportsRouter = new Hono<JwtContext>()
exportsRouter.use('*', authJwt)

const MAX_EXPORT_ROWS = 10_000

const EXPORT_COLUMNS = [
  'id', 'project_id', 'provider', 'model',
  'prompt_tokens', 'completion_tokens', 'total_tokens',
  'cost_usd', 'latency_ms', 'status_code',
  'error_message', 'trace_id', 'created_at',
] as const

type ExportColumn = (typeof EXPORT_COLUMNS)[number]

function escapeCsv(val: unknown): string {
  if (val === null || val === undefined) return ''
  const s = String(val)
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"'
  }
  return s
}

// GET /api/v1/exports/requests
// Query: format (csv|json), projectId, provider, model, providerKeyId,
//        status (ok|4xx|5xx), from, to, limit (max 10 000)
exportsRouter.get('/requests', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const format      = c.req.query('format') === 'json' ? 'json' : 'csv'
  const projectId   = c.req.query('projectId')
  const provider    = c.req.query('provider')
  const model       = c.req.query('model')
  const providerKeyId = c.req.query('providerKeyId')
  const status      = c.req.query('status')   // 'ok' | '4xx' | '5xx'
  const from        = c.req.query('from')
  const to          = c.req.query('to')
  const rawLimit    = parseInt(c.req.query('limit') ?? String(MAX_EXPORT_ROWS), 10)
  const limit       = Math.min(MAX_EXPORT_ROWS, Math.max(1, isNaN(rawLimit) ? MAX_EXPORT_ROWS : rawLimit))

  const filters: string[] = []
  const params: Record<string, unknown> = {}
  if (projectId)     { filters.push('project_id = {projectId:UUID}'); params['projectId'] = projectId }
  if (provider)      { filters.push('provider = {provider:String}'); params['provider'] = provider }
  if (model)         { filters.push('positionCaseInsensitive(model, {model:String}) > 0'); params['model'] = model }
  if (providerKeyId) { filters.push('provider_key_id = {providerKeyId:UUID}'); params['providerKeyId'] = providerKeyId }
  if (from)          { filters.push('created_at >= parseDateTime64BestEffort({from:String})'); params['from'] = from }
  if (to)            { filters.push('created_at <= parseDateTime64BestEffort({to:String})'); params['to'] = to }
  if (status === 'ok')  filters.push('status_code < 400')
  if (status === '4xx') filters.push('status_code >= 400 AND status_code < 500')
  if (status === '5xx') filters.push('status_code >= 500')

  let rows: Record<ExportColumn, unknown>[]
  try {
    const scope = await requestsScope(orgId)
    rows = await selectRequests<Record<ExportColumn, unknown>>({
      scope,
      select: EXPORT_COLUMNS.join(', '),
      filters: filters.length > 0 ? filters.join(' AND ') : undefined,
      orderBy: 'created_at DESC',
      limit,
      params,
    })
  } catch (err) {
    console.error('[exports:requests] ClickHouse query failed:', err instanceof Error ? err.message : err)
    return c.json({ error: 'Failed to export requests' }, 500)
  }

  const dateStr = new Date().toISOString().slice(0, 10)

  if (format === 'json') {
    const body = JSON.stringify(
      { exported_at: new Date().toISOString(), count: rows.length, data: rows },
      null,
      2,
    )
    return new Response(body, {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="spanlens-requests-${dateStr}.json"`,
      },
    })
  }

  // CSV
  const csvHeader = [...EXPORT_COLUMNS].join(',')
  const csvRows = rows.map((row) =>
    EXPORT_COLUMNS.map((col) => escapeCsv(row[col])).join(','),
  )
  const csv = [csvHeader, ...csvRows].join('\n')

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="spanlens-requests-${dateStr}.csv"`,
    },
  })
})

// ── helpers ───────────────────────────────────────────────────────────────────

function jsonResponse(data: unknown, filename: string): Response {
  return new Response(
    JSON.stringify({ exported_at: new Date().toISOString(), count: Array.isArray(data) ? data.length : 0, data }, null, 2),
    { headers: { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="${filename}"` } },
  )
}

function csvResponse(cols: readonly string[], rows: Record<string, unknown>[], filename: string): Response {
  const lines = [
    cols.join(','),
    ...rows.map((r) => cols.map((c) => escapeCsv(r[c])).join(',')),
  ]
  return new Response(lines.join('\n'), {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"` },
  })
}

// ── GET /api/v1/exports/traces ─────────────────────────────────────────────────
// Query: format, status (completed|error|running), from, to, limit

const TRACE_COLS = [
  'id', 'project_id', 'name', 'status', 'error_message',
  'duration_ms', 'total_cost_usd', 'total_tokens', 'span_count',
  'started_at', 'ended_at', 'created_at',
] as const

exportsRouter.get('/traces', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const format  = c.req.query('format') === 'json' ? 'json' : 'csv'
  const status  = c.req.query('status')
  const from    = c.req.query('from')
  const to      = c.req.query('to')
  const rawLimit = parseInt(c.req.query('limit') ?? String(MAX_EXPORT_ROWS), 10)
  const limit   = Math.min(MAX_EXPORT_ROWS, Math.max(1, isNaN(rawLimit) ? MAX_EXPORT_ROWS : rawLimit))

  let query = supabaseAdmin
    .from('traces')
    .select([...TRACE_COLS].join(', '))
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (status && status !== 'all') query = query.eq('status', status)
  if (from) query = query.gte('created_at', from)
  if (to)   query = query.lte('created_at', to)

  const { data, error } = await query
  if (error) return c.json({ error: 'Failed to export traces' }, 500)

  const rows = (data ?? []) as unknown as Record<string, unknown>[]
  const dateStr = new Date().toISOString().slice(0, 10)

  return format === 'json'
    ? jsonResponse(rows, `spanlens-traces-${dateStr}.json`)
    : csvResponse([...TRACE_COLS], rows, `spanlens-traces-${dateStr}.csv`)
})

// ── GET /api/v1/exports/anomalies ──────────────────────────────────────────────
// Query: format, projectId — exports current live anomaly detection result

const ANOMALY_COLS = [
  'provider', 'model', 'kind',
  'current_value', 'baseline_mean', 'baseline_stddev', 'deviations',
  'sample_count', 'reference_count',
]

exportsRouter.get('/anomalies', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const format = c.req.query('format') === 'json' ? 'json' : 'csv'
  const projectId = c.req.query('projectId')

  if (projectId) {
    const { data: proj } = await supabaseAdmin
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('organization_id', orgId)
      .single()
    if (!proj) return c.json({ error: 'Project not found' }, 404)
  }

  const anomalies = await detectAnomalies(orgId, {
    observationHours: 1,
    referenceHours: 24 * 7,
    sigmaThreshold: 3,
    ...(projectId ? { projectId } : {}),
  })

  const rows: Record<string, unknown>[] = anomalies.map((a) => ({
    provider:         a.provider,
    model:            a.model,
    kind:             a.kind,
    current_value:    a.currentValue,
    baseline_mean:    a.baselineMean,
    baseline_stddev:  a.baselineStdDev,
    deviations:       a.deviations,
    sample_count:     a.sampleCount,
    reference_count:  a.referenceCount,
  }))

  const dateStr = new Date().toISOString().slice(0, 10)

  return format === 'json'
    ? jsonResponse(rows, `spanlens-anomalies-${dateStr}.json`)
    : csvResponse(ANOMALY_COLS, rows, `spanlens-anomalies-${dateStr}.csv`)
})

// ── GET /api/v1/exports/security ───────────────────────────────────────────────
// Query: format — exports flagged requests (PII / prompt injection)

const SECURITY_COLS = [
  'id', 'provider', 'model', 'status_code', 'latency_ms', 'cost_usd', 'flags', 'created_at',
]

exportsRouter.get('/security', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const format = c.req.query('format') === 'json' ? 'json' : 'csv'

  let data: Array<{
    id: string
    provider: string
    model: string
    status_code: number
    latency_ms: number
    cost_usd: string | null
    flags: string
    created_at: string
  }>
  try {
    const scope = await requestsScope(orgId)
    data = await selectRequests({
      scope,
      select: 'id, provider, model, status_code, latency_ms, cost_usd, flags, created_at',
      // has_security_flags is the boolean derived from flags+response_flags at
      // insert time, indexed-friendly. Filtering on it beats string-comparing
      // the JSON-encoded `flags` column.
      filters: 'has_security_flags = 1',
      orderBy: 'created_at DESC',
      limit: MAX_EXPORT_ROWS,
    })
  } catch (err) {
    console.error('[exports:security] ClickHouse query failed:', err instanceof Error ? err.message : err)
    return c.json({ error: 'Failed to export security events' }, 500)
  }

  // CSV gets the flags column as a string literal; JSON parses it back to an array.
  const rows: Record<string, unknown>[] = data.map((row) => {
    if (format === 'csv') return row
    let parsedFlags: unknown = []
    try { parsedFlags = JSON.parse(row.flags) } catch { parsedFlags = row.flags }
    return { ...row, flags: parsedFlags }
  })

  const dateStr = new Date().toISOString().slice(0, 10)

  return format === 'json'
    ? jsonResponse(rows, `spanlens-security-${dateStr}.json`)
    : csvResponse(SECURITY_COLS, rows, `spanlens-security-${dateStr}.csv`)
})
