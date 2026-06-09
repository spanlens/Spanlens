import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../../middleware/authJwt.js'
import { requireSystemAdmin } from '../../middleware/requireSystemAdmin.js'
import { supabaseAdmin } from '../../lib/db.js'
import { getRegistry } from '../../lib/background-migrations/registry/index.js'
import { ApiError } from '../../lib/errors.js'

/**
 * Admin-only CRUD-ish surface for the background migration framework.
 *
 * Authorization: SPANLENS_ADMIN_EMAILS env var (see requireSystemAdmin).
 *
 * Endpoints:
 *
 *   GET    /api/v1/admin/background-migrations
 *           — list rows + which are in the code-side registry
 *   POST   /api/v1/admin/background-migrations/:name/cancel
 *           — flip a pending/running row to 'cancelled'
 *   POST   /api/v1/admin/background-migrations/:name/retry
 *           — flip a failed/cancelled row back to 'pending'
 *
 * Insertions happen via SQL seeds, NOT this router. We don't want a
 * UI button that creates registration rows out of thin air — that
 * would let a misconfiguration sit pending forever if the matching
 * code never lands.
 */
export const adminBackgroundMigrationsRouter = new Hono<JwtContext>()

adminBackgroundMigrationsRouter.use('*', authJwt, requireSystemAdmin)

interface RowResponse {
  name: string
  description: string
  status: string
  state: unknown
  progress_current: number | null
  progress_total: number | null
  last_heartbeat_at: string | null
  error_message: string | null
  attempts: number
  created_at: string
  started_at: string | null
  completed_at: string | null
  updated_at: string
  registered: boolean
}

adminBackgroundMigrationsRouter.get('/', async (c) => {
  const { data, error } = await supabaseAdmin
    .from('background_migrations')
    .select('*')
    .order('updated_at', { ascending: false })

  if (error) throw new ApiError('INTERNAL_ERROR', 'Failed to load background migrations')

  const registeredNames = new Set(getRegistry().keys())
  const rows: RowResponse[] = (data ?? []).map((row) => ({
    name: row.name as string,
    description: row.description as string,
    status: row.status as string,
    state: row.state,
    progress_current: row.progress_current as number | null,
    progress_total: row.progress_total as number | null,
    last_heartbeat_at: row.last_heartbeat_at as string | null,
    error_message: row.error_message as string | null,
    attempts: row.attempts as number,
    created_at: row.created_at as string,
    started_at: row.started_at as string | null,
    completed_at: row.completed_at as string | null,
    updated_at: row.updated_at as string,
    registered: registeredNames.has(row.name as string),
  }))

  return c.json({
    success: true,
    data: rows,
    // Surface registry entries that have no DB row yet so the admin
    // UI can hint "seed this migration to start it."
    unseededRegistrations: Array.from(registeredNames).filter(
      (name) => !rows.some((r) => r.name === name),
    ),
  })
})

adminBackgroundMigrationsRouter.post('/:name/cancel', async (c) => {
  const name = c.req.param('name')

  // Only running/pending rows can be cancelled. Cancelling a completed
  // row would be confusing — use retry to re-run instead.
  const { data: row, error: loadErr } = await supabaseAdmin
    .from('background_migrations')
    .select('status')
    .eq('name', name)
    .maybeSingle()
  if (loadErr) throw new ApiError('INTERNAL_ERROR', 'Failed to load row')
  if (!row) throw new ApiError('NOT_FOUND', 'Not found')
  if (row.status !== 'pending' && row.status !== 'running') {
    throw new ApiError('CONFLICT', `Cannot cancel row in status=${row.status as string}`)
  }

  const { error } = await supabaseAdmin
    .from('background_migrations')
    .update({
      status: 'cancelled',
      completed_at: new Date().toISOString(),
    })
    .eq('name', name)
  if (error) throw new ApiError('INTERNAL_ERROR', 'Failed to cancel')

  return c.json({ success: true })
})

adminBackgroundMigrationsRouter.post('/:name/retry', async (c) => {
  const name = c.req.param('name')

  const { data: row, error: loadErr } = await supabaseAdmin
    .from('background_migrations')
    .select('status')
    .eq('name', name)
    .maybeSingle()
  if (loadErr) throw new ApiError('INTERNAL_ERROR', 'Failed to load row')
  if (!row) throw new ApiError('NOT_FOUND', 'Not found')
  if (row.status !== 'failed' && row.status !== 'cancelled') {
    throw new ApiError('CONFLICT', `Cannot retry row in status=${row.status as string}`)
  }

  // Reset the runtime fields. Leaves `attempts` alone — the count is
  // a useful audit trail across retries.
  const { error } = await supabaseAdmin
    .from('background_migrations')
    .update({
      status: 'pending',
      error_message: null,
      completed_at: null,
      last_heartbeat_at: null,
    })
    .eq('name', name)
  if (error) throw new ApiError('INTERNAL_ERROR', 'Failed to retry')

  return c.json({ success: true })
})
