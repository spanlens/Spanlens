import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../middleware/authJwt.js'
import { supabaseAdmin } from '../lib/db.js'
import { ApiError } from '../lib/errors.js'

/**
 * /api/v1/saved-filters — per-user named filter bookmarks.
 *
 *   GET    /         list this user's saved filters
 *   POST   /         create one  { name, filters: {…} }
 *   DELETE /:id      remove one
 *
 * Scoped to (user_id, organization_id). RLS on the table enforces user_id
 * isolation; the API additionally ties new rows to the current org.
 */

export const savedFiltersRouter = new Hono<JwtContext>()
savedFiltersRouter.use('*', authJwt)

interface SavedFilterRow {
  id: string
  name: string
  filters: Record<string, unknown>
  created_at: string
}

savedFiltersRouter.get('/', async (c) => {
  const userId = c.get('userId')
  if (!userId) throw new ApiError('UNAUTHORIZED', 'Not authenticated')

  const { data, error } = await supabaseAdmin
    .from('saved_filters')
    .select('id, name, filters, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .returns<SavedFilterRow[]>()

  if (error) throw new ApiError('INTERNAL_ERROR', 'Failed to fetch filters')
  return c.json({ success: true, data: data ?? [] })
})

savedFiltersRouter.post('/', async (c) => {
  const userId = c.get('userId')
  const orgId = c.get('orgId')
  if (!userId || !orgId) throw new ApiError('UNAUTHORIZED', 'Not authenticated')

  let body: { name?: unknown; filters?: unknown }
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    throw new ApiError('INVALID_JSON_BODY', 'Invalid JSON body')
  }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name || name.length > 80) {
    throw new ApiError('VALIDATION_FAILED', 'name must be 1–80 characters')
  }
  const filters = typeof body.filters === 'object' && body.filters !== null ? body.filters : {}

  const { data, error } = await supabaseAdmin
    .from('saved_filters')
    .insert({ user_id: userId, organization_id: orgId, name, filters })
    .select('id, name, filters, created_at')
    .single()

  if (error) {
    if ((error as { code?: string }).code === '23505') {
      throw new ApiError('CONFLICT', 'A filter with this name already exists')
    }
    throw new ApiError('INTERNAL_ERROR', 'Failed to save filter')
  }
  return c.json({ success: true, data }, 201)
})

savedFiltersRouter.delete('/:id', async (c) => {
  const userId = c.get('userId')
  if (!userId) throw new ApiError('UNAUTHORIZED', 'Not authenticated')

  const id = c.req.param('id')
  const { error } = await supabaseAdmin
    .from('saved_filters')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)

  if (error) throw new ApiError('INTERNAL_ERROR', 'Failed to delete')
  return c.json({ success: true })
})
