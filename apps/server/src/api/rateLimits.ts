import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../middleware/authJwt.js'
import { requireRole } from '../middleware/requireRole.js'
import { supabaseAdmin } from '../lib/db.js'
import { recordAuditEvent } from '../lib/audit-log.js'
import {
  invalidateCustomerLimitsCache,
  resetCustomerLimitsCache,
} from '../lib/customer-limits.js'
import { ApiError } from '../lib/errors.js'

/**
 * Customer-configurable rate limits (Phase 2). Dashboard CRUD for the limits a
 * customer sets on their own Spanlens keys / projects / end-users. Enforcement
 * lives in middleware/customerRateLimit.ts; config rows are in the
 * `customer_rate_limits` table (migration 20260619000000).
 *
 * Auth mirrors apiKeysRouter / providerKeysRouter: authJwt for all routes,
 * requireRole('admin','editor') on writes. Every target is verified to belong
 * to the caller's org before any read or write.
 */

export const rateLimitsRouter = new Hono<JwtContext>()

rateLimitsRouter.use('*', authJwt)

const requireEdit = requireRole('admin', 'editor')

const VALID_WINDOWS = new Set([60, 3600, 86400])
const SELECT_COLUMNS =
  'id, target_type, api_key_id, project_id, end_user_id, max_requests, window_seconds, is_active, created_at, updated_at'

/** Verify the Spanlens key belongs to a project owned by `orgId`. */
async function assertApiKeyInOrg(apiKeyId: string, orgId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('api_keys')
    .select('id, projects!inner(organization_id)')
    .eq('id', apiKeyId)
    .maybeSingle()
  if (!data) return false
  const project = data.projects as unknown as { organization_id: string } | null
  return project?.organization_id === orgId
}

/** Verify the project belongs to `orgId`. */
async function assertProjectInOrg(projectId: string, orgId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('organization_id', orgId)
    .maybeSingle()
  return Boolean(data)
}

interface CreateBody {
  target_type?: unknown
  api_key_id?: unknown
  project_id?: unknown
  end_user_id?: unknown
  max_requests?: unknown
  window_seconds?: unknown
}

function validateMaxRequests(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isInteger(n) || n <= 0) {
    throw new ApiError('VALIDATION_FAILED', 'max_requests must be a positive integer')
  }
  return n
}

function validateWindow(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!VALID_WINDOWS.has(n)) {
    throw new ApiError('VALIDATION_FAILED', 'window_seconds must be one of 60, 3600, 86400')
  }
  return n
}

// GET /api/v1/rate-limits?apiKeyId=xxx | ?projectId=xxx
// Lists configured limits for a key (key-level + its end-user limits) or a
// project. Requires one of the two filters so we never leak the whole org.
rateLimitsRouter.get('/', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  const apiKeyId = c.req.query('apiKeyId')
  const projectId = c.req.query('projectId')

  let query = supabaseAdmin
    .from('customer_rate_limits')
    .select(SELECT_COLUMNS)
    .eq('organization_id', orgId)

  if (apiKeyId) {
    if (!(await assertApiKeyInOrg(apiKeyId, orgId))) {
      throw new ApiError('FORBIDDEN', 'apiKeyId does not belong to this organization')
    }
    query = query.eq('api_key_id', apiKeyId)
  } else if (projectId) {
    if (!(await assertProjectInOrg(projectId, orgId))) {
      throw new ApiError('FORBIDDEN', 'projectId does not belong to this organization')
    }
    query = query.eq('project_id', projectId).eq('target_type', 'project')
  } else {
    throw new ApiError('VALIDATION_FAILED', 'apiKeyId or projectId query param is required')
  }

  const { data, error } = await query.order('created_at', { ascending: true })
  if (error) throw new ApiError('INTERNAL_ERROR', 'Failed to load rate limits')
  return c.json({ success: true, data: data ?? [] })
})

// POST /api/v1/rate-limits — create a limit.
rateLimitsRouter.post('/', requireEdit, async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  let body: CreateBody
  try {
    body = (await c.req.json()) as CreateBody
  } catch {
    throw new ApiError('INVALID_JSON_BODY', 'Request body must be valid JSON')
  }

  const targetType = body.target_type
  if (targetType !== 'api_key' && targetType !== 'project' && targetType !== 'end_user') {
    throw new ApiError('VALIDATION_FAILED', "target_type must be 'api_key', 'project', or 'end_user'")
  }

  const maxRequests = validateMaxRequests(body.max_requests)
  const windowSeconds = validateWindow(body.window_seconds)

  // Resolve + verify ownership of the target, and shape the row to satisfy the
  // DB owner-consistency CHECK.
  const row: Record<string, unknown> = {
    organization_id: orgId,
    target_type: targetType,
    max_requests: maxRequests,
    window_seconds: windowSeconds,
    api_key_id: null,
    project_id: null,
    end_user_id: null,
  }

  let invalidateKeyId: string | null = null

  if (targetType === 'api_key') {
    const apiKeyId = body.api_key_id
    if (typeof apiKeyId !== 'string' || !(await assertApiKeyInOrg(apiKeyId, orgId))) {
      throw new ApiError('FORBIDDEN', 'api_key_id does not belong to this organization')
    }
    row['api_key_id'] = apiKeyId
    invalidateKeyId = apiKeyId
  } else if (targetType === 'project') {
    const projectId = body.project_id
    if (typeof projectId !== 'string' || !(await assertProjectInOrg(projectId, orgId))) {
      throw new ApiError('FORBIDDEN', 'project_id does not belong to this organization')
    }
    row['project_id'] = projectId
  } else {
    // end_user: requires the scoping api_key_id + the end-user identifier
    const apiKeyId = body.api_key_id
    const endUserId = body.end_user_id
    if (typeof apiKeyId !== 'string' || !(await assertApiKeyInOrg(apiKeyId, orgId))) {
      throw new ApiError('FORBIDDEN', 'api_key_id does not belong to this organization')
    }
    if (typeof endUserId !== 'string' || endUserId.trim().length === 0) {
      throw new ApiError('VALIDATION_FAILED', 'end_user_id is required for an end_user limit')
    }
    row['api_key_id'] = apiKeyId
    row['end_user_id'] = endUserId.trim()
    invalidateKeyId = apiKeyId
  }

  const { data, error } = await supabaseAdmin
    .from('customer_rate_limits')
    .insert(row)
    .select(SELECT_COLUMNS)
    .single()

  if (error || !data) {
    if (error?.code === '23505') {
      throw new ApiError('CONFLICT', 'A rate limit already exists for this target')
    }
    throw new ApiError('INTERNAL_ERROR', 'Failed to create rate limit')
  }

  if (invalidateKeyId) invalidateCustomerLimitsCache(invalidateKeyId)
  else resetCustomerLimitsCache()

  void recordAuditEvent(c, {
    action: 'rate_limit.create',
    resourceType: 'customer_rate_limits',
    resourceId: data.id as string,
    metadata: { target_type: targetType, max_requests: maxRequests, window_seconds: windowSeconds },
  })

  return c.json({ success: true, data }, 201)
})

interface PatchBody {
  max_requests?: unknown
  window_seconds?: unknown
  is_active?: unknown
}

// PATCH /api/v1/rate-limits/:id — update max_requests / window_seconds / is_active.
rateLimitsRouter.patch('/:id', requireEdit, async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')
  const id = c.req.param('id')

  let body: PatchBody
  try {
    body = (await c.req.json()) as PatchBody
  } catch {
    throw new ApiError('INVALID_JSON_BODY', 'Request body must be valid JSON')
  }

  const updates: Record<string, unknown> = {}
  if (body.max_requests !== undefined) updates['max_requests'] = validateMaxRequests(body.max_requests)
  if (body.window_seconds !== undefined) updates['window_seconds'] = validateWindow(body.window_seconds)
  if (body.is_active !== undefined) {
    if (typeof body.is_active !== 'boolean') {
      throw new ApiError('VALIDATION_FAILED', 'is_active must be a boolean')
    }
    updates['is_active'] = body.is_active
  }
  if (Object.keys(updates).length === 0) {
    throw new ApiError('VALIDATION_FAILED', 'No updatable fields provided')
  }

  const { data, error } = await supabaseAdmin
    .from('customer_rate_limits')
    .update(updates)
    .eq('id', id)
    .eq('organization_id', orgId)
    .select(SELECT_COLUMNS)
    .maybeSingle()

  if (error) throw new ApiError('INTERNAL_ERROR', 'Failed to update rate limit')
  if (!data) throw new ApiError('NOT_FOUND', 'Rate limit not found')

  const keyId = data.api_key_id as string | null
  if (keyId) invalidateCustomerLimitsCache(keyId)
  else resetCustomerLimitsCache()

  void recordAuditEvent(c, {
    action: 'rate_limit.update',
    resourceType: 'customer_rate_limits',
    resourceId: id,
    metadata: { fields: Object.keys(updates) },
  })

  return c.json({ success: true, data })
})

// DELETE /api/v1/rate-limits/:id — hard delete (low-risk config, not a secret).
rateLimitsRouter.delete('/:id', requireEdit, async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')
  const id = c.req.param('id')

  const { data, error } = await supabaseAdmin
    .from('customer_rate_limits')
    .delete()
    .eq('id', id)
    .eq('organization_id', orgId)
    .select('id, api_key_id')
    .maybeSingle()

  if (error) throw new ApiError('INTERNAL_ERROR', 'Failed to delete rate limit')
  if (!data) throw new ApiError('NOT_FOUND', 'Rate limit not found')

  const keyId = data.api_key_id as string | null
  if (keyId) invalidateCustomerLimitsCache(keyId)
  else resetCustomerLimitsCache()

  void recordAuditEvent(c, {
    action: 'rate_limit.delete',
    resourceType: 'customer_rate_limits',
    resourceId: id,
  })

  return c.json({ success: true })
})
