import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../middleware/authJwt.js'
import { requireRole } from '../middleware/requireRole.js'
import { supabaseAdmin } from '../lib/db.js'
import { comparePromptVersions } from '../lib/prompt-compare.js'
import { invalidatePromptName } from '../lib/prompt-cache.js'
import { enqueueDeletion } from '../lib/pending-deletions.js'
import { recordAuditEvent } from '../lib/audit-log.js'
import { startEvalRun } from '../lib/eval-runner.js'
import { requestsScope, selectRequests } from '../lib/requests-query.js'
import { parsePositiveFloat } from '../lib/params.js'
import { ApiError } from '../lib/errors.js'

const requireEdit = requireRole('admin', 'editor')

/**
 * /api/v1/prompts — prompt version registry.
 *
 *   GET    /                 list prompts (latest version per name)
 *   GET    /:name            list all versions for a prompt name
 *   GET    /:name/:version   fetch one version
 *   POST   /                 create a new version (auto-increments version number)
 *   DELETE /:name/:version   delete one version
 *
 * Versions are immutable once created. Editing = creating a new version.
 */

export const promptsRouter = new Hono<JwtContext>()

promptsRouter.use('*', authJwt)

interface PromptVariable {
  name: string
  description?: string
  required?: boolean
}

interface PromptStats {
  calls: number
  totalCostUsd: number
  avgCostUsd: number | null
  avgLatencyMs: number | null
  errorRate: number | null
}

const EMPTY_STATS: PromptStats = {
  calls: 0,
  totalCostUsd: 0,
  avgCostUsd: null,
  avgLatencyMs: null,
  errorRate: null,
}

// GET /  — latest version of every named prompt, with 24h usage stats inline
promptsRouter.get('/', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  const projectId = c.req.query('projectId')

  let query = supabaseAdmin
    .from('prompt_versions')
    .select('id, name, version, content, variables, metadata, project_id, created_at, created_by')
    .eq('organization_id', orgId)
    .order('name', { ascending: true })
    .order('version', { ascending: false })

  if (projectId) query = query.eq('project_id', projectId)

  const { data, error } = await query
  if (error) throw new ApiError('INTERNAL_ERROR', 'Failed to fetch prompts')

  const allRows = data ?? []

  // Group all version ids by prompt name so we can aggregate across versions
  const idsByName = new Map<string, string[]>()
  for (const row of allRows) {
    const bucket = idsByName.get(row.name) ?? []
    bucket.push(row.id as string)
    idsByName.set(row.name, bucket)
  }

  // Latest version per name (first occurrence because we ordered version desc)
  const seen = new Set<string>()
  const latest = allRows.filter((row) => {
    if (seen.has(row.name)) return false
    seen.add(row.name)
    return true
  })

  // versionCount per prompt name (more accurate than using latest version number)
  const versionCountByName = new Map<string, number>()
  for (const [name, ids] of idsByName) versionCountByName.set(name, ids.length)

  // Aggregate request metrics per prompt_version_id, then roll up per name.
  // sinceHours defaults to 24h; the UI passes the selected date range.
  const sinceHours = parsePositiveFloat(c.req.query('sinceHours'), 24)
  const sinceIso = new Date(Date.now() - sinceHours * 3_600_000).toISOString()
  const allVersionIds = allRows.map((r) => r.id as string)
  const statsByName = new Map<string, PromptStats>()

  if (allVersionIds.length > 0) {
    interface PromptStatRow {
      prompt_version_id: string | null
      latency_ms: number | null
      cost_usd: string | number | null
      status_code: number | null
    }
    const sinceTs = sinceIso.replace('T', ' ').replace('Z', '')
    let reqs: PromptStatRow[] = []
    try {
      const scope = await requestsScope(orgId)
      reqs = await selectRequests<PromptStatRow>({
        scope,
        select: 'prompt_version_id, latency_ms, cost_usd, status_code',
        filters:
          'prompt_version_id IN {versionIds:Array(UUID)} ' +
          'AND created_at >= parseDateTime64BestEffort({sinceTs:String})',
        params: { versionIds: allVersionIds, sinceTs },
      })
    } catch (err) {
      console.error('[prompts:stats] ClickHouse query failed:', err instanceof Error ? err.message : err)
    }

    const versionIdToName = new Map<string, string>()
    for (const [name, ids] of idsByName) for (const id of ids) versionIdToName.set(id, name)

    const perName = new Map<string, { calls: number; cost: number; latency: number; errors: number }>()
    for (const raw of reqs) {
      const r = {
        prompt_version_id: raw.prompt_version_id,
        latency_ms: raw.latency_ms,
        cost_usd: raw.cost_usd == null ? null : Number(raw.cost_usd),
        status_code: raw.status_code,
      }
      if (!r.prompt_version_id) continue
      const name = versionIdToName.get(r.prompt_version_id)
      if (!name) continue
      const agg = perName.get(name) ?? { calls: 0, cost: 0, latency: 0, errors: 0 }
      agg.calls += 1
      agg.cost += r.cost_usd ?? 0
      agg.latency += r.latency_ms ?? 0
      if (r.status_code !== null && r.status_code >= 400) agg.errors += 1
      perName.set(name, agg)
    }

    for (const [name, agg] of perName) {
      statsByName.set(name, {
        calls: agg.calls,
        totalCostUsd: agg.cost,
        avgCostUsd: agg.calls > 0 ? agg.cost / agg.calls : null,
        avgLatencyMs: agg.calls > 0 ? agg.latency / agg.calls : null,
        errorRate: agg.calls > 0 ? agg.errors / agg.calls : null,
      })
    }
  }

  // Quality score per prompt name: 100 * (1 - errorRate) for the window
  const qualityByName = new Map<string, number | null>()
  for (const [name, stats] of statsByName) {
    qualityByName.set(
      name,
      stats.calls > 0 && stats.errorRate !== null
        ? Math.round(100 * (1 - stats.errorRate))
        : null,
    )
  }

  // Running A/B experiments for this org (batch lookup)
  const promptNames = latest.map((r) => r.name)
  const activeExpByName = new Map<string, { id: string; trafficSplit: number }>()
  if (promptNames.length > 0) {
    const { data: runningExps } = await supabaseAdmin
      .from('prompt_ab_experiments')
      .select('id, prompt_name, traffic_split')
      .eq('organization_id', orgId)
      .eq('status', 'running')
      .in('prompt_name', promptNames)
    for (const exp of runningExps ?? []) {
      activeExpByName.set(exp.prompt_name, { id: exp.id, trafficSplit: exp.traffic_split })
    }
  }

  const enriched = latest.map((row) => ({
    ...row,
    versionCount: versionCountByName.get(row.name) ?? 1,
    stats: statsByName.get(row.name) ?? EMPTY_STATS,
    qualityScore: qualityByName.get(row.name) ?? null,
    activeExperiment: activeExpByName.get(row.name) ?? null,
  }))

  return c.json({ success: true, data: enriched })
})

// GET /:name — all versions of a named prompt
promptsRouter.get('/:name', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')
  const name = c.req.param('name')

  const { data, error } = await supabaseAdmin
    .from('prompt_versions')
    .select('id, name, version, content, variables, metadata, project_id, created_at, created_by')
    .eq('organization_id', orgId)
    .eq('name', name)
    .order('version', { ascending: false })

  if (error) throw new ApiError('INTERNAL_ERROR', 'Failed to fetch versions')
  return c.json({ success: true, data: data ?? [] })
})

// GET /:name/compare — per-version metrics for A/B comparison
promptsRouter.get('/:name/compare', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')
  const name = c.req.param('name')
  const sinceHours = parsePositiveFloat(c.req.query('sinceHours'), 24 * 30)

  const metrics = await comparePromptVersions(orgId, name, { sinceHours })
  return c.json({ success: true, data: metrics, meta: { name, sinceHours } })
})

// GET /:name/:version — one specific version
promptsRouter.get('/:name/:version', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')
  const name = c.req.param('name')
  const version = Number(c.req.param('version'))
  if (!Number.isInteger(version) || version < 1) {
    throw new ApiError('VALIDATION_FAILED', 'Invalid version')
  }

  const { data, error } = await supabaseAdmin
    .from('prompt_versions')
    .select('id, name, version, content, variables, metadata, project_id, created_at, created_by')
    .eq('organization_id', orgId)
    .eq('name', name)
    .eq('version', version)
    .maybeSingle()

  if (error || !data) throw new ApiError('NOT_FOUND', 'Version not found')
  return c.json({ success: true, data })
})

// POST /  — create new version (auto-increment)
promptsRouter.post('/', requireEdit, async (c) => {
  const orgId = c.get('orgId')
  const userId = c.get('userId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  let body: {
    name?: unknown
    content?: unknown
    variables?: unknown
    metadata?: unknown
    projectId?: unknown
  }
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    throw new ApiError('INVALID_JSON_BODY', 'Invalid JSON body')
  }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const content = typeof body.content === 'string' ? body.content : ''
  if (!name) throw new ApiError('VALIDATION_FAILED', 'name is required')
  if (!content) throw new ApiError('VALIDATION_FAILED', 'content is required')
  if (name.length > 128) throw new ApiError('VALIDATION_FAILED', 'name too long (max 128)')
  if (content.length > 100_000) throw new ApiError('VALIDATION_FAILED', 'content too long (max 100K)')

  const variables: PromptVariable[] = Array.isArray(body.variables)
    ? (body.variables as PromptVariable[]).filter(
        (v): v is PromptVariable => typeof v === 'object' && v !== null && typeof v.name === 'string',
      )
    : []
  const metadata =
    typeof body.metadata === 'object' && body.metadata !== null ? body.metadata : {}
  const projectId = typeof body.projectId === 'string' ? body.projectId : null

  // Verify the project belongs to this org so a caller can't attach a prompt
  // to another org's project UUID (cross-project filter pollution).
  if (projectId) {
    const { data: proj } = await supabaseAdmin
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('organization_id', orgId)
      .maybeSingle()
    if (!proj) throw new ApiError('NOT_FOUND', 'Project not found')
  }

  // Find the latest version for this name and increment
  const { data: latest } = await supabaseAdmin
    .from('prompt_versions')
    .select('version')
    .eq('organization_id', orgId)
    .eq('name', name)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()

  const nextVersion = (latest?.version ?? 0) + 1

  const { data, error } = await supabaseAdmin
    .from('prompt_versions')
    .insert({
      organization_id: orgId,
      project_id: projectId,
      name,
      version: nextVersion,
      content,
      variables,
      metadata,
      created_by: userId,
    })
    .select('id, name, version, content, variables, metadata, project_id, created_at, created_by')
    .single()

  if (error || !data) {
    // UNIQUE(organization_id, name, version) — a concurrent save that computed
    // the same nextVersion loses the insert race. Surface a clean 409 (the
    // caller can retry and get the next number) instead of a raw 500.
    if (error?.code === '23505') {
      throw new ApiError('CONFLICT', 'This prompt version already exists. Retry to create the next version.')
    }
    throw new ApiError('INTERNAL_ERROR', 'Failed to create version')
  }
  // Invalidate resolve-prompt-version cache for this prompt name so the new
  // latest version is served immediately on the next proxy call.
  await invalidatePromptName(orgId, name)

  void recordAuditEvent(c, {
    action: 'prompt_version.create',
    resourceType: 'prompt_versions',
    resourceId: data.id,
    metadata: {
      name: data.name,
      version: data.version,
      project_id: data.project_id,
    },
  })

  // P2-10: auto-run evaluators flagged for version creation (golden regression
  // suite). A new version has no production traffic yet, so each is a DATASET
  // run that generates responses for the evaluator's golden dataset and scores
  // them. Fire-and-forget — version creation must not wait on (or fail from)
  // the eval runs. Only evaluators that opted in (auto_run_on_version=true)
  // run; the DB CHECK guarantees the dataset/provider/model are set.
  const { data: autoEvals } = await supabaseAdmin
    .from('evaluators')
    .select('id, auto_run_dataset_id, auto_run_provider, auto_run_model, auto_run_sample_size')
    .eq('organization_id', orgId)
    .eq('prompt_name', name)
    .eq('auto_run_on_version', true)
    // P2-11: trajectory evaluators score traces, not prompt versions — they
    // must never be auto-run on a new prompt version (their prompt_name holds a
    // trace name, so a name collision could otherwise match them here).
    .neq('type', 'trajectory')
    .is('archived_at', null)

  for (const ev of autoEvals ?? []) {
    if (!ev.auto_run_dataset_id || !ev.auto_run_provider || !ev.auto_run_model) continue
    await startEvalRun(c, {
      organizationId: orgId,
      evaluatorId: ev.id,
      promptVersionId: data.id,
      source: 'dataset',
      datasetId: ev.auto_run_dataset_id,
      sampleSize: ev.auto_run_sample_size ?? 50,
      runProvider: ev.auto_run_provider,
      runModel: ev.auto_run_model,
      createdBy: userId,
    })
  }

  return c.json({ success: true, data }, 201)
})

// POST /:name/:version/rollback — create a new version copied from the target
// "Rollback" is non-destructive: it creates a new version with the same
// content and variables so version history stays intact.
promptsRouter.post('/:name/:version/rollback', requireEdit, async (c) => {
  const orgId = c.get('orgId')
  const userId = c.get('userId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')
  const name = c.req.param('name')
  const version = Number(c.req.param('version'))
  if (!Number.isInteger(version) || version < 1) {
    throw new ApiError('VALIDATION_FAILED', 'Invalid version')
  }

  const { data: source, error: fetchErr } = await supabaseAdmin
    .from('prompt_versions')
    .select('content, variables, metadata, project_id')
    .eq('organization_id', orgId)
    .eq('name', name)
    .eq('version', version)
    .maybeSingle()

  if (fetchErr || !source) throw new ApiError('NOT_FOUND', 'Version not found')

  const { data: latest } = await supabaseAdmin
    .from('prompt_versions')
    .select('version')
    .eq('organization_id', orgId)
    .eq('name', name)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()

  const nextVersion = (latest?.version ?? 0) + 1

  const { data, error } = await supabaseAdmin
    .from('prompt_versions')
    .insert({
      organization_id: orgId,
      project_id: source.project_id,
      name,
      version: nextVersion,
      content: source.content,
      variables: source.variables ?? [],
      metadata: { ...(source.metadata as object ?? {}), rolledBackFrom: version },
      created_by: userId,
    })
    .select('id, name, version, content, variables, metadata, project_id, created_at, created_by')
    .single()

  if (error || !data) {
    // Same UNIQUE(organization_id, name, version) race as POST / — a
    // concurrent rollback/save that grabbed the same nextVersion loses.
    if (error?.code === '23505') {
      throw new ApiError('CONFLICT', 'This prompt version already exists. Retry to create the next version.')
    }
    throw new ApiError('INTERNAL_ERROR', 'Failed to create rollback version')
  }
  await invalidatePromptName(orgId, name)

  void recordAuditEvent(c, {
    action: 'prompt_version.rollback',
    resourceType: 'prompt_versions',
    resourceId: data.id,
    metadata: {
      name: data.name,
      new_version: data.version,
      rolled_back_from: version,
    },
  })

  return c.json({ success: true, data }, 201)
})

// DELETE /:name/:version — soft delete via pending_deletions queue.
//
// The row stays around for ~72 hours. A running A/B experiment that
// references this version will still resolve correctly during the grace
// window (the row is intact, only the queue marks it for removal). The
// FK-violation check used to live here; under the new model the cron
// re-runs the hard delete on the next pass if it still fails, so users
// don't need to manually retry.
promptsRouter.delete('/:name/:version', requireEdit, async (c) => {
  const orgId = c.get('orgId')
  const userId = c.get('userId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')
  const name = c.req.param('name')
  const version = Number(c.req.param('version'))
  if (!Number.isInteger(version) || version < 1) {
    throw new ApiError('VALIDATION_FAILED', 'Invalid version')
  }

  const { data: snapshot } = await supabaseAdmin
    .from('prompt_versions')
    .select('*')
    .eq('organization_id', orgId)
    .eq('name', name)
    .eq('version', version)
    .maybeSingle()
  if (!snapshot) throw new ApiError('NOT_FOUND', 'Version not found')

  const enqueued = await enqueueDeletion({
    organizationId: orgId,
    resourceType: 'prompt_version',
    resourceId: snapshot.id as string,
    resourceSnapshot: snapshot as Record<string, unknown>,
    requestedBy: userId ?? null,
  })

  if (!enqueued.ok) {
    if (enqueued.code === 'ALREADY_PENDING') {
      throw new ApiError('CONFLICT', 'Already queued for deletion')
    }
    throw new ApiError('INTERNAL_ERROR', enqueued.error ?? 'Failed to queue deletion')
  }

  // Resolve cache must drop any "latest" entry that pointed here; if this
  // was the highest version the next resolve should fall back to the next
  // version down (still alive during the grace window).
  await invalidatePromptName(orgId, name)

  void recordAuditEvent(c, {
    action: 'prompt_version.delete',
    resourceType: 'prompt_versions',
    resourceId: snapshot.id as string,
    metadata: {
      name,
      version,
      pending_deletion_id: enqueued.pendingId,
      scheduled_for: enqueued.scheduledFor,
    },
  })

  return c.json({
    success: true,
    pendingDeletionId: enqueued.pendingId,
    scheduledFor: enqueued.scheduledFor,
  })
})
