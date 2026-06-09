import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../middleware/authJwt.js'
import { requireRole } from '../middleware/requireRole.js'
import { supabaseAdmin } from '../lib/db.js'
import { invalidatePromptName } from '../lib/prompt-cache.js'
import { recordAuditEvent } from '../lib/audit-log.js'
import { requestsScope, selectRequests } from '../lib/requests-query.js'
import {
  errorRateTest,
  welchTest,
  type StatResult,
} from '../lib/prompt-experiment-stats.js'
import { ApiError } from '../lib/errors.js'

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
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

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
  if (error) throw new ApiError('INTERNAL_ERROR', 'Failed to fetch experiments')

  return c.json({ success: true, data: data ?? [] })
})

// ── Create ────────────────────────────────────────────────────────────────────

promptExperimentsRouter.post('/', requireEdit, async (c) => {
  const orgId = c.get('orgId')
  const userId = c.get('userId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

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
    throw new ApiError('INVALID_JSON_BODY', 'Invalid JSON body')
  }

  const promptName = typeof body.promptName === 'string' ? body.promptName.trim() : ''
  const versionAId = typeof body.versionAId === 'string' ? body.versionAId.trim() : ''
  const versionBId = typeof body.versionBId === 'string' ? body.versionBId.trim() : ''

  if (!promptName) throw new ApiError('VALIDATION_FAILED', 'promptName is required')
  if (!versionAId) throw new ApiError('VALIDATION_FAILED', 'versionAId is required')
  if (!versionBId) throw new ApiError('VALIDATION_FAILED', 'versionBId is required')
  if (versionAId === versionBId) throw new ApiError('BAD_REQUEST', 'versionAId and versionBId must differ')

  const trafficSplit =
    typeof body.trafficSplit === 'number' ? Math.round(body.trafficSplit) : 50
  if (trafficSplit < 1 || trafficSplit > 99)
    throw new ApiError('VALIDATION_FAILED', 'trafficSplit must be between 1 and 99')

  const endsAt = typeof body.endsAt === 'string' ? body.endsAt : null
  const projectId = typeof body.projectId === 'string' ? body.projectId : null

  // Verify both versions belong to this org and have the right prompt name
  const { data: versions } = await supabaseAdmin
    .from('prompt_versions')
    .select('id, name')
    .eq('organization_id', orgId)
    .in('id', [versionAId, versionBId])

  if (!versions || versions.length !== 2)
    throw new ApiError('NOT_FOUND', 'One or both prompt versions not found in this organization')

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
      throw new ApiError('CONFLICT', 'An experiment is already running for this prompt')
    throw new ApiError('INTERNAL_ERROR', 'Failed to create experiment')
  }

  // Invalidate the resolve cache: the next `name@latest` request must see
  // the new experiment metadata, not a pre-experiment cached versionId.
  await invalidatePromptName(orgId, promptName)

  void recordAuditEvent(c, {
    action: 'ab_experiment.start',
    resourceType: 'prompt_ab_experiments',
    resourceId: data.id,
    metadata: {
      prompt_name: promptName,
      version_a_id: versionAId,
      version_b_id: versionBId,
      traffic_split: trafficSplit,
    },
  })

  return c.json({ success: true, data }, 201)
})

// ── Get one + computed stats ──────────────────────────────────────────────────

promptExperimentsRouter.get('/:id', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')
  const id = c.req.param('id')

  const { data: exp, error } = await supabaseAdmin
    .from('prompt_ab_experiments')
    .select('*')
    .eq('organization_id', orgId)
    .eq('id', id)
    .maybeSingle()

  if (error || !exp) throw new ApiError('NOT_FOUND', 'Experiment not found')

  // Fetch request metrics for both arms from ClickHouse.
  const sinceTs = (exp.started_at as string).replace('T', ' ').replace('Z', '')
  const untilTs = (exp.concluded_at as string | null ?? new Date().toISOString())
    .replace('T', ' ')
    .replace('Z', '')

  interface ArmMetricRow {
    prompt_version_id: string | null
    latency_ms: number | null
    cost_usd: string | number | null
    status_code: number | null
  }
  let rawRows: ArmMetricRow[] = []
  try {
    const scope = await requestsScope(orgId)
    rawRows = await selectRequests<ArmMetricRow>({
      scope,
      select: 'prompt_version_id, latency_ms, cost_usd, status_code',
      filters:
        'prompt_version_id IN {versionIds:Array(UUID)} ' +
        'AND created_at >= parseDateTime64BestEffort({sinceTs:String}) ' +
        'AND created_at <= parseDateTime64BestEffort({untilTs:String})',
      params: {
        versionIds: [exp.version_a_id, exp.version_b_id],
        sinceTs,
        untilTs,
      },
    })
  } catch (err) {
    console.error('[prompt-experiments] ClickHouse query failed:', err instanceof Error ? err.message : err)
  }
  const rows = rawRows.map((r) => ({
    prompt_version_id: r.prompt_version_id,
    latency_ms: r.latency_ms,
    // cost_usd arrives as a string for Decimal columns — coerce at the boundary.
    cost_usd: r.cost_usd == null ? null : Number(r.cost_usd),
    status_code: r.status_code,
  }))

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
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')
  const id = c.req.param('id')

  let body: {
    status?: unknown
    winnerVersionId?: unknown
    endsAt?: unknown
  }
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    throw new ApiError('INVALID_JSON_BODY', 'Invalid JSON body')
  }

  const updates: Record<string, unknown> = {}

  if (typeof body.status === 'string') {
    if (!['concluded', 'stopped'].includes(body.status))
      throw new ApiError('VALIDATION_FAILED', 'status must be "concluded" or "stopped"')
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
    throw new ApiError('BAD_REQUEST', 'No valid fields to update')

  const { data, error } = await supabaseAdmin
    .from('prompt_ab_experiments')
    .update(updates)
    .eq('organization_id', orgId)
    .eq('id', id)
    .select()
    .maybeSingle()

  if (error || !data) throw new ApiError('INTERNAL_ERROR', 'Failed to update experiment')

  // Status change (concluded/stopped) flips traffic back to plain `latest`,
  // so the cached experiment metadata must be dropped.
  if (typeof data.prompt_name === 'string') {
    await invalidatePromptName(orgId, data.prompt_name)
  }

  // Map the new status to a distinct audit verb so the timeline reads
  // naturally ("ab_experiment.conclude" vs "ab_experiment.stop"). Updates
  // that only change ends_at fall through to a generic `update`.
  const newStatus = typeof updates.status === 'string' ? updates.status : null
  const action =
    newStatus === 'concluded'
      ? 'ab_experiment.conclude'
      : newStatus === 'stopped'
        ? 'ab_experiment.stop'
        : 'ab_experiment.update'
  void recordAuditEvent(c, {
    action,
    resourceType: 'prompt_ab_experiments',
    resourceId: data.id as string,
    metadata: {
      prompt_name: data.prompt_name,
      status: newStatus ?? undefined,
      winner_version_id: updates.winner_version_id ?? undefined,
      ends_at: updates.ends_at ?? undefined,
    },
  })

  return c.json({ success: true, data })
})

// ── Delete ────────────────────────────────────────────────────────────────────

promptExperimentsRouter.delete('/:id', requireRole('admin'), async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')
  const id = c.req.param('id')

  // Only allow deleting non-running experiments
  const { data: exp } = await supabaseAdmin
    .from('prompt_ab_experiments')
    .select('status, prompt_name')
    .eq('organization_id', orgId)
    .eq('id', id)
    .maybeSingle()

  if (!exp) throw new ApiError('NOT_FOUND', 'Experiment not found')
  if (exp.status === 'running')
    throw new ApiError('CONFLICT', 'Stop or conclude the experiment before deleting')

  const { error } = await supabaseAdmin
    .from('prompt_ab_experiments')
    .delete()
    .eq('organization_id', orgId)
    .eq('id', id)

  if (error) throw new ApiError('INTERNAL_ERROR', 'Failed to delete experiment')
  // Belt-and-braces: PATCH already invalidated when status moved to
  // stopped/concluded, but a direct delete (e.g. backfill cleanup) still
  // needs the cache flushed in case anything raced.
  if (typeof exp.prompt_name === 'string') {
    await invalidatePromptName(orgId, exp.prompt_name)
  }

  void recordAuditEvent(c, {
    action: 'ab_experiment.delete',
    resourceType: 'prompt_ab_experiments',
    resourceId: id,
    metadata: {
      prompt_name: exp.prompt_name,
      previous_status: exp.status,
    },
  })

  return c.json({ success: true })
})
