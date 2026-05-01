import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../middleware/authJwt.js'
import { requireRole } from '../middleware/requireRole.js'
import { supabaseAdmin } from '../lib/db.js'
import {
  errorRateTest,
  welchTest,
  type StatResult,
} from '../lib/prompt-experiment-stats.js'

const requireEdit = requireRole('admin', 'editor')

/**
 * /api/v1/prompt-experiments
 *
 *   GET    /                              list experiments (optionally filtered by promptName)
 *   POST   /                              create experiment
 *   GET    /:id                           get one experiment + stats
 *   PATCH  /:id                           update status / winner / ends_at
 *   DELETE /:id                           delete (admin only, only stopped/concluded)
 */

export const promptExperimentsRouter = new Hono<JwtContext>()

promptExperimentsRouter.use('*', authJwt)

// ── List ──────────────────────────────────────────────────────────────────────

promptExperimentsRouter.get('/', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const promptName = c.req.query('promptName')
  const status = c.req.query('status') // 'running' | 'concluded' | 'stopped'

  let query = supabaseAdmin
    .from('prompt_ab_experiments')
    .select(
      'id, prompt_name, version_a_id, version_b_id, traffic_split, status, ' +
        'started_at, ends_at, concluded_at, winner_version_id, created_by, project_id',
    )
    .eq('organization_id', orgId)
    .order('started_at', { ascending: false })

  if (promptName) query = query.eq('prompt_name', promptName)
  if (status) query = query.eq('status', status)

  const { data, error } = await query
  if (error) return c.json({ error: 'Failed to fetch experiments' }, 500)

  return c.json({ success: true, data: data ?? [] })
})

// ── Create ────────────────────────────────────────────────────────────────────

promptExperimentsRouter.post('/', requireEdit, async (c) => {
  const orgId = c.get('orgId')
  const userId = c.get('userId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  let body: {
    promptName?: unknown
    versionAId?: unknown
    versionBId?: unknown
    trafficSplit?: unknown
    endsAt?: unknown
    projectId?: unknown
  }
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const promptName = typeof body.promptName === 'string' ? body.promptName.trim() : ''
  const versionAId = typeof body.versionAId === 'string' ? body.versionAId.trim() : ''
  const versionBId = typeof body.versionBId === 'string' ? body.versionBId.trim() : ''

  if (!promptName) return c.json({ error: 'promptName is required' }, 400)
  if (!versionAId) return c.json({ error: 'versionAId is required' }, 400)
  if (!versionBId) return c.json({ error: 'versionBId is required' }, 400)
  if (versionAId === versionBId) return c.json({ error: 'versionAId and versionBId must differ' }, 400)

  const trafficSplit =
    typeof body.trafficSplit === 'number' ? Math.round(body.trafficSplit) : 50
  if (trafficSplit < 1 || trafficSplit > 99)
    return c.json({ error: 'trafficSplit must be between 1 and 99' }, 400)

  const endsAt = typeof body.endsAt === 'string' ? body.endsAt : null
  const projectId = typeof body.projectId === 'string' ? body.projectId : null

  // Verify both versions belong to this org and have the right prompt name
  const { data: versions } = await supabaseAdmin
    .from('prompt_versions')
    .select('id, name')
    .eq('organization_id', orgId)
    .in('id', [versionAId, versionBId])

  if (!versions || versions.length !== 2)
    return c.json({ error: 'One or both prompt versions not found in this organization' }, 404)

  for (const v of versions) {
    if (v.name !== promptName)
      return c.json({ error: `Version ${v.id} belongs to prompt "${v.name}", not "${promptName}"` }, 400)
  }

  const { data, error } = await supabaseAdmin
    .from('prompt_ab_experiments')
    .insert({
      organization_id: orgId,
      project_id: projectId,
      prompt_name: promptName,
      version_a_id: versionAId,
      version_b_id: versionBId,
      traffic_split: trafficSplit,
      ends_at: endsAt,
      created_by: userId,
    })
    .select()
    .single()

  if (error) {
    // Unique partial index violation → already running experiment
    if (error.code === '23505')
      return c.json({ error: 'An experiment is already running for this prompt' }, 409)
    return c.json({ error: 'Failed to create experiment' }, 500)
  }

  return c.json({ success: true, data }, 201)
})

// ── Get one + computed stats ──────────────────────────────────────────────────

promptExperimentsRouter.get('/:id', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)
  const id = c.req.param('id')

  const { data: exp, error } = await supabaseAdmin
    .from('prompt_ab_experiments')
    .select('*')
    .eq('organization_id', orgId)
    .eq('id', id)
    .maybeSingle()

  if (error || !exp) return c.json({ error: 'Experiment not found' }, 404)

  // Fetch request metrics for both arms
  const sinceIso = exp.started_at
  const untilIso = exp.concluded_at ?? new Date().toISOString()

  const { data: reqs } = await supabaseAdmin
    .from('requests')
    .select('prompt_version_id, latency_ms, cost_usd, status_code')
    .eq('organization_id', orgId)
    .in('prompt_version_id', [exp.version_a_id, exp.version_b_id])
    .gte('created_at', sinceIso)
    .lte('created_at', untilIso)

  const rows = (reqs ?? []) as Array<{
    prompt_version_id: string | null
    latency_ms: number | null
    cost_usd: number | null
    status_code: number | null
  }>

  const armRows = (vid: string) => rows.filter((r) => r.prompt_version_id === vid)

  function computeArm(vid: string) {
    const armR = armRows(vid)
    const n = armR.length
    if (n === 0)
      return { samples: 0, errorRate: 0, avgLatencyMs: 0, avgCostUsd: 0, totalCostUsd: 0, varLatency: 0, varCost: 0 }

    let latSum = 0, latCount = 0, costSum = 0, costCount = 0, errors = 0
    for (const r of armR) {
      if (typeof r.latency_ms === 'number') { latSum += r.latency_ms; latCount++ }
      if (typeof r.cost_usd === 'number') { costSum += r.cost_usd; costCount++ }
      if (typeof r.status_code === 'number' && r.status_code >= 400) errors++
    }
    const avgLat = latCount > 0 ? latSum / latCount : 0
    const avgCost = costCount > 0 ? costSum / costCount : 0

    // Sample variance
    let latVar = 0, costVar = 0
    for (const r of armR) {
      if (typeof r.latency_ms === 'number') latVar += (r.latency_ms - avgLat) ** 2
      if (typeof r.cost_usd === 'number') costVar += (r.cost_usd - avgCost) ** 2
    }

    return {
      samples: n,
      errorRate: errors / n,
      avgLatencyMs: avgLat,
      avgCostUsd: avgCost,
      totalCostUsd: costSum,
      varLatency: latCount > 1 ? latVar / (latCount - 1) : 0,
      varCost: costCount > 1 ? costVar / (costCount - 1) : 0,
    }
  }

  const armA = computeArm(exp.version_a_id)
  const armB = computeArm(exp.version_b_id)

  const errorRateStat: StatResult = errorRateTest(
    armA.samples, Math.round(armA.errorRate * armA.samples),
    armB.samples, Math.round(armB.errorRate * armB.samples),
  )
  const latencyStat: StatResult = welchTest(
    armA.samples, armA.avgLatencyMs, armA.varLatency,
    armB.samples, armB.avgLatencyMs, armB.varLatency,
  )
  const costStat: StatResult = welchTest(
    armA.samples, armA.avgCostUsd, armA.varCost,
    armB.samples, armB.avgCostUsd, armB.varCost,
  )

  return c.json({
    success: true,
    data: {
      experiment: exp,
      stats: {
        armA,
        armB,
        significance: {
          errorRate: errorRateStat,
          latency: latencyStat,
          cost: costStat,
        },
      },
    },
  })
})

// ── Update (status / winner / ends_at) ───────────────────────────────────────

promptExperimentsRouter.patch('/:id', requireEdit, async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)
  const id = c.req.param('id')

  let body: {
    status?: unknown
    winnerVersionId?: unknown
    endsAt?: unknown
  }
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const updates: Record<string, unknown> = {}

  if (typeof body.status === 'string') {
    if (!['concluded', 'stopped'].includes(body.status))
      return c.json({ error: 'status must be "concluded" or "stopped"' }, 400)
    updates.status = body.status
    if (body.status === 'concluded') {
      updates.concluded_at = new Date().toISOString()
    }
  }
  if (typeof body.winnerVersionId === 'string') {
    updates.winner_version_id = body.winnerVersionId
  }
  if (typeof body.endsAt === 'string' || body.endsAt === null) {
    updates.ends_at = body.endsAt
  }

  if (Object.keys(updates).length === 0)
    return c.json({ error: 'No valid fields to update' }, 400)

  const { data, error } = await supabaseAdmin
    .from('prompt_ab_experiments')
    .update(updates)
    .eq('organization_id', orgId)
    .eq('id', id)
    .select()
    .maybeSingle()

  if (error || !data) return c.json({ error: 'Failed to update experiment' }, 500)
  return c.json({ success: true, data })
})

// ── Delete ────────────────────────────────────────────────────────────────────

promptExperimentsRouter.delete('/:id', requireRole('admin'), async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)
  const id = c.req.param('id')

  // Only allow deleting non-running experiments
  const { data: exp } = await supabaseAdmin
    .from('prompt_ab_experiments')
    .select('status')
    .eq('organization_id', orgId)
    .eq('id', id)
    .maybeSingle()

  if (!exp) return c.json({ error: 'Experiment not found' }, 404)
  if (exp.status === 'running')
    return c.json({ error: 'Stop or conclude the experiment before deleting' }, 409)

  const { error } = await supabaseAdmin
    .from('prompt_ab_experiments')
    .delete()
    .eq('organization_id', orgId)
    .eq('id', id)

  if (error) return c.json({ error: 'Failed to delete experiment' }, 500)
  return c.json({ success: true })
})
