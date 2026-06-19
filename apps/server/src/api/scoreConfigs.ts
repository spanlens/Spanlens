import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../middleware/authJwt.js'
import { supabaseAdmin } from '../lib/db.js'
import { recordAuditEvent } from '../lib/audit-log.js'
import {
  parseCategories,
  validateScoreConfigShape,
} from '../lib/score-validation.js'
import {
  normaliseString,
  normaliseNullableString,
  normaliseNullableNumber,
} from '../lib/validation-helpers.js'
import { ApiError } from '../lib/errors.js'

/**
 * Score configs CRUD. Drives the typed-score work in 4B.1: every
 * eval_result and human_eval row points at exactly one of these via
 * `score_config_id`, and the type stored here determines which value
 * column gets populated on insert.
 *
 * Mount path: /api/v1/score-configs.
 *
 * Auth model: workspace-scoped, JWT-only. We deliberately do NOT expose
 * this to public sl_live_pub_* keys — score config CRUD is org admin
 * work and goes through the dashboard, not the SDK.
 */
export const scoreConfigsRouter = new Hono<JwtContext>()

scoreConfigsRouter.use('*', authJwt)

interface ScoreConfigBody {
  name?: unknown
  description?: unknown
  data_type?: unknown
  min_value?: unknown
  max_value?: unknown
  categories?: unknown
  bool_true_label?: unknown
  bool_false_label?: unknown
  is_default?: unknown
  archived?: unknown
}

const ALLOWED_TYPES = ['NUMERIC', 'CATEGORICAL', 'BOOLEAN', 'TEXT'] as const

// GET /api/v1/score-configs — active configs for the org, newest first
scoreConfigsRouter.get('/', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  const includeArchived = c.req.query('includeArchived') === '1'

  let query = supabaseAdmin
    .from('score_configs')
    .select('*')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })

  if (!includeArchived) query = query.is('archived_at', null)

  const { data, error } = await query
  if (error) throw new ApiError('INTERNAL_ERROR', 'Failed to load score configs')
  return c.json({ success: true, data: data ?? [] })
})

// GET /api/v1/score-configs/:id
scoreConfigsRouter.get('/:id', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')
  const id = c.req.param('id')

  const { data, error } = await supabaseAdmin
    .from('score_configs')
    .select('*')
    .eq('id', id)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (error) throw new ApiError('INTERNAL_ERROR', 'Failed to load score config')
  if (!data) throw new ApiError('NOT_FOUND', 'Score config not found')
  return c.json({ success: true, data })
})

// POST /api/v1/score-configs — create a new config
scoreConfigsRouter.post('/', async (c) => {
  const orgId = c.get('orgId')
  const userId = c.get('userId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  let body: ScoreConfigBody
  try {
    body = (await c.req.json()) as ScoreConfigBody
  } catch {
    throw new ApiError('INVALID_JSON_BODY', 'Invalid JSON body')
  }

  const name = normaliseString(body.name)
  if (name.length === 0) throw new ApiError('VALIDATION_FAILED', 'name is required')
  if (name.length > 100) throw new ApiError('VALIDATION_FAILED', 'name must be 100 characters or fewer')

  const data_type = typeof body.data_type === 'string' ? body.data_type.toUpperCase() : ''
  if (!ALLOWED_TYPES.includes(data_type as (typeof ALLOWED_TYPES)[number])) {
    throw new ApiError('VALIDATION_FAILED', `data_type must be one of ${ALLOWED_TYPES.join(', ')}`)
  }

  const min_value = normaliseNullableNumber(body.min_value)
  const max_value = normaliseNullableNumber(body.max_value)
  const categories = Array.isArray(body.categories) ? body.categories : null

  const shapeError = validateScoreConfigShape({
    data_type,
    min_value,
    max_value,
    categories,
  })
  if (shapeError) throw new ApiError('VALIDATION_FAILED', shapeError)

  // For CATEGORICAL we store the cleaned list (deduped strings).
  const categoriesClean = data_type === 'CATEGORICAL' ? parseCategories(categories) : null

  const description = normaliseNullableString(body.description)
  const bool_true_label = normaliseNullableString(body.bool_true_label)
  const bool_false_label = normaliseNullableString(body.bool_false_label)

  // If the caller asks for is_default we first clear the existing
  // default on the workspace; the unique partial index would 23505
  // otherwise. Two-step inside the same request rather than a CTE
  // because the API surface is plain PostgREST.
  const wantsDefault = body.is_default === true
  if (wantsDefault) {
    await supabaseAdmin
      .from('score_configs')
      .update({ is_default: false })
      .eq('organization_id', orgId)
      .eq('is_default', true)
  }

  const insertRow: {
    organization_id: string
    name: string
    description: string | null
    data_type: string
    min_value: number | null
    max_value: number | null
    categories: string[] | null
    bool_true_label: string | null
    bool_false_label: string | null
    is_default: boolean
    created_by: string | null
  } = {
    organization_id: orgId,
    name,
    description,
    data_type,
    min_value,
    max_value,
    categories: categoriesClean,
    bool_true_label,
    bool_false_label,
    is_default: wantsDefault,
    created_by: userId ?? null,
  }

  const { data, error } = await supabaseAdmin
    .from('score_configs')
    .insert(insertRow)
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      throw new ApiError('CONFLICT', 'A score config with that name already exists')
    }
    throw new ApiError('INTERNAL_ERROR', 'Failed to create score config')
  }

  void recordAuditEvent(c, {
    action: 'score_config.create',
    resourceType: 'score_config',
    resourceId: data.id,
    metadata: { name, data_type, is_default: wantsDefault },
  })

  return c.json({ success: true, data })
})

// PATCH /api/v1/score-configs/:id — update mutable fields
scoreConfigsRouter.patch('/:id', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')
  const id = c.req.param('id')

  let body: ScoreConfigBody
  try {
    body = (await c.req.json()) as ScoreConfigBody
  } catch {
    throw new ApiError('INVALID_JSON_BODY', 'Invalid JSON body')
  }

  // Load existing row so we can validate the merged shape.
  const { data: existing, error: loadError } = await supabaseAdmin
    .from('score_configs')
    .select('*')
    .eq('id', id)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (loadError) throw new ApiError('INTERNAL_ERROR', 'Failed to load score config')
  if (!existing) throw new ApiError('NOT_FOUND', 'Score config not found')

  // Data type is immutable — flipping NUMERIC → BOOLEAN mid-stream
  // would invalidate every existing value column. If the user really
  // wants a different shape they archive this one and create a new
  // config.
  if (typeof body.data_type === 'string' && body.data_type !== existing.data_type) {
    throw new ApiError('BAD_REQUEST', 'data_type cannot be changed; archive and create a new config instead')
  }

  const updates: Record<string, unknown> = {}
  let auditedFields: string[] = []

  if (typeof body.name === 'string') {
    const n = normaliseString(body.name)
    if (n.length === 0) throw new ApiError('BAD_REQUEST', 'name must not be empty')
    if (n.length > 100) throw new ApiError('VALIDATION_FAILED', 'name must be 100 characters or fewer')
    updates.name = n
    auditedFields.push('name')
  }
  if (body.description !== undefined) {
    updates.description = normaliseNullableString(body.description)
    auditedFields.push('description')
  }
  if (body.min_value !== undefined) {
    updates.min_value = normaliseNullableNumber(body.min_value)
    auditedFields.push('min_value')
  }
  if (body.max_value !== undefined) {
    updates.max_value = normaliseNullableNumber(body.max_value)
    auditedFields.push('max_value')
  }
  if (body.categories !== undefined) {
    updates.categories = Array.isArray(body.categories)
      ? parseCategories(body.categories)
      : null
    auditedFields.push('categories')
  }
  if (body.bool_true_label !== undefined) {
    updates.bool_true_label = normaliseNullableString(body.bool_true_label)
    auditedFields.push('bool_true_label')
  }
  if (body.bool_false_label !== undefined) {
    updates.bool_false_label = normaliseNullableString(body.bool_false_label)
    auditedFields.push('bool_false_label')
  }

  // Validate the merged shape — the existing row plus whatever fields
  // the patch is replacing.
  const merged = { ...existing, ...updates }
  const shapeError = validateScoreConfigShape({
    data_type: merged.data_type,
    min_value: merged.min_value,
    max_value: merged.max_value,
    categories: merged.categories,
  })
  if (shapeError) throw new ApiError('VALIDATION_FAILED', shapeError)

  if (body.archived === true && !existing.archived_at) {
    updates.archived_at = new Date().toISOString()
    auditedFields.push('archived')
  } else if (body.archived === false && existing.archived_at) {
    updates.archived_at = null
    auditedFields.push('restored')
  }

  if (body.is_default === true && !existing.is_default) {
    await supabaseAdmin
      .from('score_configs')
      .update({ is_default: false })
      .eq('organization_id', orgId)
      .eq('is_default', true)
    updates.is_default = true
    auditedFields.push('is_default')
  } else if (body.is_default === false && existing.is_default) {
    updates.is_default = false
    auditedFields.push('is_default')
  }

  if (Object.keys(updates).length === 0) {
    return c.json({ success: true, data: existing })
  }

  const { data, error } = await supabaseAdmin
    .from('score_configs')
    .update(updates)
    .eq('id', id)
    .eq('organization_id', orgId)
    .select()
    .single()
  if (error) {
    if (error.code === '23505') {
      throw new ApiError('CONFLICT', 'A score config with that name already exists')
    }
    throw new ApiError('INTERNAL_ERROR', 'Failed to update score config')
  }

  void recordAuditEvent(c, {
    action: 'score_config.update',
    resourceType: 'score_config',
    resourceId: id,
    metadata: { fields: auditedFields },
  })

  return c.json({ success: true, data })
})

// DELETE /api/v1/score-configs/:id — soft delete (archive)
//
// We chose archive instead of hard delete because eval_results rows
// reference this config and a hard delete would silently break the
// dashboard charts that group by score_config_id. The unused-config
// cleanup is a separate concern handled by a future cron.
scoreConfigsRouter.delete('/:id', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')
  const id = c.req.param('id')

  const { data: existing, error: loadError } = await supabaseAdmin
    .from('score_configs')
    .select('id, name, is_default, archived_at')
    .eq('id', id)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (loadError) throw new ApiError('INTERNAL_ERROR', 'Failed to load score config')
  if (!existing) throw new ApiError('NOT_FOUND', 'Score config not found')
  if (existing.archived_at) return c.json({ success: true, data: existing })

  if (existing.is_default) {
    return c.json(
      { error: 'Cannot archive the default config; promote another config first' },
      409,
    )
  }

  const { data, error } = await supabaseAdmin
    .from('score_configs')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id)
    .eq('organization_id', orgId)
    .select()
    .single()
  if (error) throw new ApiError('INTERNAL_ERROR', 'Failed to archive score config')

  void recordAuditEvent(c, {
    action: 'score_config.archive',
    resourceType: 'score_config',
    resourceId: id,
    metadata: { name: existing.name },
  })

  return c.json({ success: true, data })
})
