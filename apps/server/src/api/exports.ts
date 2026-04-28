import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../middleware/authJwt.js'
import { supabaseAdmin } from '../lib/db.js'

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

  let query = supabaseAdmin
    .from('requests')
    .select(EXPORT_COLUMNS.join(', '))
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (projectId)     query = query.eq('project_id', projectId)
  if (provider)      query = query.eq('provider', provider)
  if (model)         query = query.eq('model', model)
  if (providerKeyId) query = query.eq('provider_key_id', providerKeyId)
  if (from)          query = query.gte('created_at', from)
  if (to)            query = query.lte('created_at', to)
  if (status === 'ok')  query = query.lt('status_code', 400)
  if (status === '4xx') query = query.gte('status_code', 400).lt('status_code', 500)
  if (status === '5xx') query = query.gte('status_code', 500)

  const { data, error } = await query
  if (error) return c.json({ error: 'Failed to export requests' }, 500)

  const rows = (data ?? []) as unknown as Record<ExportColumn, unknown>[]
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
