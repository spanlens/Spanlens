import { Hono, type Context } from 'hono'
import { authJwt, type JwtContext } from '../middleware/authJwt.js'
import { requireRole } from '../middleware/requireRole.js'
import { detectAnomalies } from '../lib/anomaly.js'
import { getAnomalyHistory } from '../lib/anomaly-snapshot.js'
import { supabaseAdmin } from '../lib/db.js'

const requireEdit = requireRole('admin', 'editor')

/**
 * Anomaly endpoints.
 *
 *   GET    /api/v1/anomalies              live detection (with ack state)
 *   GET    /api/v1/anomalies/history      persisted history from cron snapshots
 *   POST   /api/v1/anomalies/ack          acknowledge one (provider/model/kind)
 *   DELETE /api/v1/anomalies/ack          un-acknowledge
 */

export const anomaliesRouter = new Hono<JwtContext>()

anomaliesRouter.use('*', authJwt)

const VALID_KINDS = new Set(['latency', 'cost', 'error_rate'])

function parsePositiveNumber(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function parseClampedNumber(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (!raw) return fallback
  const n = Number(raw)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

interface AckKey {
  provider: string
  model: string
  kind: string
}

function ackKey(a: AckKey): string {
  return `${a.provider}|${a.model}|${a.kind}`
}

anomaliesRouter.get('/', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const observationHours = parseClampedNumber(c.req.query('observationHours'), 1, 0.25, 72)
  const referenceHours = parseClampedNumber(c.req.query('referenceHours'), 168, 1, 8760)
  const sigmaThreshold = parseClampedNumber(c.req.query('sigma'), 3, 1, 10)
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

  const [anomalies, acksRes] = await Promise.all([
    detectAnomalies(orgId, {
      observationHours,
      referenceHours,
      sigmaThreshold,
      ...(projectId ? { projectId } : {}),
    }),
    supabaseAdmin
      .from('anomaly_acks')
      .select('provider, model, kind, acknowledged_at')
      .eq('organization_id', orgId),
  ])

  const ackMap = new Map<string, string>()
  for (const row of acksRes.data ?? []) {
    ackMap.set(ackKey(row as AckKey), (row as { acknowledged_at: string }).acknowledged_at)
  }

  const withAcks = anomalies.map((a) => ({
    ...a,
    acknowledgedAt: ackMap.get(ackKey(a)) ?? null,
  }))

  return c.json({
    success: true,
    data: withAcks,
    meta: {
      observationHours,
      referenceHours,
      sigmaThreshold,
      count: withAcks.length,
    },
  })
})

// GET /api/v1/anomalies/history?days=30
anomaliesRouter.get('/history', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const days = Math.min(parsePositiveNumber(c.req.query('days'), 30), 365)
  const history = await getAnomalyHistory(orgId, days)

  return c.json({
    success: true,
    data: history,
    meta: { days, count: history.length },
  })
})

async function parseAckBody(
  c: Context<JwtContext>,
): Promise<{ error: string } | { provider: string; model: string; kind: string }> {
  let body: { provider?: unknown; model?: unknown; kind?: unknown }
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    return { error: 'Invalid JSON body' }
  }
  if (typeof body.provider !== 'string' || body.provider.trim().length === 0) {
    return { error: 'provider is required' }
  }
  if (typeof body.model !== 'string' || body.model.trim().length === 0) {
    return { error: 'model is required' }
  }
  if (typeof body.kind !== 'string' || !VALID_KINDS.has(body.kind)) {
    return { error: 'kind must be one of: latency, cost, error_rate' }
  }
  return { provider: body.provider, model: body.model, kind: body.kind }
}

// POST /api/v1/anomalies/ack — acknowledge (upsert)
anomaliesRouter.post('/ack', requireEdit, async (c) => {
  const orgId = c.get('orgId')
  const userId = c.get('userId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const parsed = await parseAckBody(c)
  if ('error' in parsed) return c.json({ error: parsed.error }, 400)

  const { error } = await supabaseAdmin
    .from('anomaly_acks')
    .upsert({
      organization_id: orgId,
      provider: parsed.provider,
      model: parsed.model,
      kind: parsed.kind,
      acknowledged_by: userId ?? null,
      acknowledged_at: new Date().toISOString(),
    }, { onConflict: 'organization_id,provider,model,kind' })

  if (error) return c.json({ error: 'Failed to acknowledge anomaly' }, 500)

  return c.json({ success: true })
})

// DELETE /api/v1/anomalies/ack?provider=X&model=Y&kind=Z — un-acknowledge
anomaliesRouter.delete('/ack', requireEdit, async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const provider = c.req.query('provider')
  const model = c.req.query('model')
  const kind = c.req.query('kind')

  if (!provider) return c.json({ error: 'provider is required' }, 400)
  if (!model) return c.json({ error: 'model is required' }, 400)
  if (!kind || !VALID_KINDS.has(kind)) {
    return c.json({ error: 'kind must be one of: latency, cost, error_rate' }, 400)
  }

  const { error } = await supabaseAdmin
    .from('anomaly_acks')
    .delete()
    .eq('organization_id', orgId)
    .eq('provider', provider)
    .eq('model', model)
    .eq('kind', kind)

  if (error) return c.json({ error: 'Failed to un-acknowledge' }, 500)

  return c.json({ success: true })
})
