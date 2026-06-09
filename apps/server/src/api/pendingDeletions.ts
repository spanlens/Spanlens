import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../middleware/authJwt.js'
import { requireRole } from '../middleware/requireRole.js'
import { supabaseAdmin } from '../lib/db.js'
import {
  hardDeleteByType,
  reactivateByType,
  type PendingResourceType,
} from '../lib/pending-deletions.js'
import { recordAuditEvent } from '../lib/audit-log.js'
import { ApiError } from '../lib/errors.js'

/**
 * /api/v1/pending-deletions — list + restore the soft-delete queue.
 *
 *   GET    /                 list active (un-executed, un-cancelled) rows
 *   GET    /history          list completed rows (executed or cancelled) for audit
 *   POST   /:id/restore      cancel a pending deletion and reactivate the source
 *
 * Enqueueing happens in the resource-owning routers (apiKeys, providerKeys,
 * prompts) via `enqueueDeletion()`. The cron in cron.ts walks due rows and
 * calls `hardDeleteByType()`.
 *
 * Restore is gated to admin/editor — same role required to delete in the
 * first place — to keep blast-radius symmetry.
 */

export const pendingDeletionsRouter = new Hono<JwtContext>()

pendingDeletionsRouter.use('*', authJwt)

const requireEdit = requireRole('admin', 'editor')

interface ListedRow {
  id: string
  resourceType: string
  resourceId: string
  resourceSnapshot: Record<string, unknown>
  requestedAt: string
  scheduledFor: string
  requestedBy: string | null
  cancelledAt: string | null
  cancelledBy: string | null
  executedAt: string | null
}

function shape(row: {
  id: string
  resource_type: string
  resource_id: string
  resource_snapshot: unknown
  requested_at: string
  scheduled_for: string
  requested_by: string | null
  cancelled_at: string | null
  cancelled_by: string | null
  executed_at: string | null
}): ListedRow {
  return {
    id: row.id,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    resourceSnapshot: (row.resource_snapshot ?? {}) as Record<string, unknown>,
    requestedAt: row.requested_at,
    scheduledFor: row.scheduled_for,
    requestedBy: row.requested_by,
    cancelledAt: row.cancelled_at,
    cancelledBy: row.cancelled_by,
    executedAt: row.executed_at,
  }
}

// GET /api/v1/pending-deletions — active queue (not yet executed or cancelled)
pendingDeletionsRouter.get('/', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  const { data, error } = await supabaseAdmin
    .from('pending_deletions')
    .select(
      'id, resource_type, resource_id, resource_snapshot, requested_at, scheduled_for, requested_by, cancelled_at, cancelled_by, executed_at',
    )
    .eq('organization_id', orgId)
    .is('cancelled_at', null)
    .is('executed_at', null)
    .order('scheduled_for', { ascending: true })

  if (error) throw new ApiError('INTERNAL_ERROR', 'Failed to load pending deletions')
  return c.json({ success: true, data: (data ?? []).map(shape) })
})

// GET /api/v1/pending-deletions/history — last 50 terminal rows for audit
pendingDeletionsRouter.get('/history', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  const { data, error } = await supabaseAdmin
    .from('pending_deletions')
    .select(
      'id, resource_type, resource_id, resource_snapshot, requested_at, scheduled_for, requested_by, cancelled_at, cancelled_by, executed_at',
    )
    .eq('organization_id', orgId)
    .or('cancelled_at.not.is.null,executed_at.not.is.null')
    .order('requested_at', { ascending: false })
    .limit(50)

  if (error) throw new ApiError('INTERNAL_ERROR', 'Failed to load history')
  return c.json({ success: true, data: (data ?? []).map(shape) })
})

// POST /api/v1/pending-deletions/:id/restore — cancel the deletion + reactivate
pendingDeletionsRouter.post('/:id/restore', requireEdit, async (c) => {
  const orgId = c.get('orgId')
  const userId = c.get('userId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  const pendingId = c.req.param('id')

  // Load the row first so we can verify the org match before any restore work.
  const { data: row } = await supabaseAdmin
    .from('pending_deletions')
    .select('id, organization_id, resource_type, resource_id, resource_snapshot, cancelled_at, executed_at')
    .eq('id', pendingId)
    .maybeSingle()

  if (!row) throw new ApiError('NOT_FOUND', 'Pending deletion not found')
  if (row.organization_id !== orgId) throw new ApiError('FORBIDDEN', 'Access denied')
  if (row.executed_at) {
    // TODO(sprint-8): manual migration (unmapped status 410)
    // TODO(sprint-8): manual migration (unmapped status 410)
    return c.json({ error: 'Already hard-deleted; cannot restore' }, 410)
  }
  if (row.cancelled_at) {
    throw new ApiError('CONFLICT', 'Already restored')
  }

  const reactivation = await reactivateByType(
    row.resource_type as PendingResourceType,
    row.resource_id,
    orgId,
    (row.resource_snapshot ?? {}) as Record<string, unknown>,
  )
  if (!reactivation.ok) {
    throw new ApiError('CONFLICT', reactivation.error)
  }

  const { error: updateErr } = await supabaseAdmin
    .from('pending_deletions')
    .update({
      cancelled_at: new Date().toISOString(),
      cancelled_by: userId ?? null,
    })
    .eq('id', pendingId)
    .is('cancelled_at', null)
    .is('executed_at', null)

  if (updateErr) throw new ApiError('INTERNAL_ERROR', 'Failed to mark restored')

  void recordAuditEvent(c, {
    action: 'pending_deletion.restore',
    resourceType: 'pending_deletions',
    resourceId: pendingId,
    metadata: {
      resource_type: row.resource_type,
      resource_id: row.resource_id,
      restored: reactivation.restored,
    },
  })

  return c.json({ success: true, restored: reactivation.restored })
})

/**
 * Cron-callable executor. Exported so cron.ts can call it without going
 * through the HTTP boundary. Returns a summary the cron handler can log.
 */
export async function executePendingDeletions(opts: {
  batchSize?: number
} = {}): Promise<{
  picked: number
  executed: number
  failed: number
  errors: { id: string; error: string }[]
}> {
  const batchSize = opts.batchSize ?? 100

  const { data: due, error } = await supabaseAdmin
    .from('pending_deletions')
    .select('id, organization_id, resource_type, resource_id')
    .lte('scheduled_for', new Date().toISOString())
    .is('cancelled_at', null)
    .is('executed_at', null)
    .order('scheduled_for', { ascending: true })
    .limit(batchSize)

  if (error || !due) {
    return { picked: 0, executed: 0, failed: 0, errors: [] }
  }

  let executed = 0
  let failed = 0
  const errors: { id: string; error: string }[] = []

  for (const row of due) {
    const result = await hardDeleteByType(
      row.resource_type as PendingResourceType,
      row.resource_id,
      row.organization_id,
    )
    if (!result.ok) {
      failed++
      errors.push({ id: row.id, error: result.error })
      continue
    }

    // Stamp executed_at. We re-check the same "still active" predicate to
    // avoid races where a parallel restore landed during the hard delete.
    // If the row is no longer active, we still consider the hard-delete
    // successful but skip the update; the active-uniq index guarantees
    // there's no orphan to fix up.
    const { error: stampErr } = await supabaseAdmin
      .from('pending_deletions')
      .update({ executed_at: new Date().toISOString() })
      .eq('id', row.id)
      .is('cancelled_at', null)
      .is('executed_at', null)

    if (stampErr) {
      failed++
      errors.push({ id: row.id, error: stampErr.message })
      continue
    }

    executed++
  }

  return { picked: due.length, executed, failed, errors }
}
