import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../middleware/authJwt.js'
import { supabaseAdmin } from '../lib/db.js'
import { comparePromptVersions } from '../lib/prompt-compare.js'

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
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const projectId = c.req.query('projectId')

  let query = supabaseAdmin
    .from('prompt_versions')
    .select('id, name, version, content, variables, metadata, project_id, created_at, created_by')
    .eq('organization_id', orgId)
    .order('name', { ascending: true })
    .order('version', { ascending: false })

  if (projectId) query = query.eq('project_id', projectId)

  const { data, error } = await query
  if (error) return c.json({ error: 'Failed to fetch prompts' }, 500)

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

  // Aggregate 24h request metrics per prompt_version_id, then roll up per name
  const sinceIso = new Date(Date.now() - 24 * 3_600_000).toISOString()
  const allVersionIds = allRows.map((r) => r.id as string)
  const statsByName = new Map<string, PromptStats>()

  if (allVersionIds.length > 0) {
    const { data: reqs } = await supabaseAdmin
      .from('requests')
      .select('prompt_version_id, latency_ms, cost_usd, status_code')
      .eq('organization_id', orgId)
      .in('prompt_version_id', allVersionIds)
      .gte('created_at', sinceIso)

    const versionIdToName = new Map<string, string>()
    for (const [name, ids] of idsByName) for (const id of ids) versionIdToName.set(id, name)

    const perName = new Map<string, { calls: number; cost: number; latency: number; errors: number }>()
    for (const r of (reqs ?? []) as Array<{
      prompt_version_id: string | null
      latency_ms: number | null
      cost_usd: number | null
      status_code: number | null
    }>) {
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

  const enriched = latest.map((row) => ({
    ...row,
    stats: statsByName.get(row.name) ?? EMPTY_STATS,
  }))

  return c.json({ success: true, data: enriched })
})

// GET /:name — all versions of a named prompt
promptsRouter.get('/:name', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)
  const name = c.req.param('name')

  const { data, error } = await supabaseAdmin
    .from('prompt_versions')
    .select('id, name, version, content, variables, metadata, project_id, created_at, created_by')
    .eq('organization_id', orgId)
    .eq('name', name)
    .order('version', { ascending: false })

  if (error) return c.json({ error: 'Failed to fetch versions' }, 500)
  return c.json({ success: true, data: data ?? [] })
})

// GET /:name/compare — per-version metrics for A/B comparison
promptsRouter.get('/:name/compare', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)
  const name = c.req.param('name')
  const sinceHoursRaw = Number(c.req.query('sinceHours'))
  const sinceHours =
    Number.isFinite(sinceHoursRaw) && sinceHoursRaw > 0 ? sinceHoursRaw : 24 * 30

  const metrics = await comparePromptVersions(orgId, name, { sinceHours })
  return c.json({ success: true, data: metrics, meta: { name, sinceHours } })
})

// GET /:name/:version — one specific version
promptsRouter.get('/:name/:version', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)
  const name = c.req.param('name')
  const version = Number(c.req.param('version'))
  if (!Number.isInteger(version) || version < 1) {
    return c.json({ error: 'Invalid version' }, 400)
  }

  const { data, error } = await supabaseAdmin
    .from('prompt_versions')
    .select('id, name, version, content, variables, metadata, project_id, created_at, created_by')
    .eq('organization_id', orgId)
    .eq('name', name)
    .eq('version', version)
    .maybeSingle()

  if (error || !data) return c.json({ error: 'Version not found' }, 404)
  return c.json({ success: true, data })
})

// POST /  — create new version (auto-increment)
promptsRouter.post('/', async (c) => {
  const orgId = c.get('orgId')
  const userId = c.get('userId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

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
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const content = typeof body.content === 'string' ? body.content : ''
  if (!name) return c.json({ error: 'name is required' }, 400)
  if (!content) return c.json({ error: 'content is required' }, 400)
  if (name.length > 128) return c.json({ error: 'name too long (max 128)' }, 400)
  if (content.length > 100_000) return c.json({ error: 'content too long (max 100K)' }, 400)

  const variables: PromptVariable[] = Array.isArray(body.variables)
    ? (body.variables as PromptVariable[]).filter(
        (v): v is PromptVariable => typeof v === 'object' && v !== null && typeof v.name === 'string',
      )
    : []
  const metadata =
    typeof body.metadata === 'object' && body.metadata !== null ? body.metadata : {}
  const projectId = typeof body.projectId === 'string' ? body.projectId : null

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

  if (error || !data) return c.json({ error: 'Failed to create version' }, 500)
  return c.json({ success: true, data }, 201)
})

// DELETE /:name/:version — remove one version
promptsRouter.delete('/:name/:version', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)
  const name = c.req.param('name')
  const version = Number(c.req.param('version'))
  if (!Number.isInteger(version) || version < 1) {
    return c.json({ error: 'Invalid version' }, 400)
  }

  const { error } = await supabaseAdmin
    .from('prompt_versions')
    .delete()
    .eq('organization_id', orgId)
    .eq('name', name)
    .eq('version', version)

  if (error) return c.json({ error: 'Failed to delete' }, 500)
  return c.json({ success: true })
})
