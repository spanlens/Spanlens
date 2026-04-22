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

// GET /  — latest version of every named prompt in this org
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

  // Keep only the latest version per name
  const seen = new Set<string>()
  const latest = (data ?? []).filter((row) => {
    if (seen.has(row.name)) return false
    seen.add(row.name)
    return true
  })

  return c.json({ success: true, data: latest })
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
