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
import { isUuid } from '../lib/params.js'

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
 *
 * Restore and the cron never act on a row they have not claimed (C5.4).
 * Restore claims by stamping cancelled_at; the cron claims by stamping
 * execution_claimed_at. Each claim is a conditional UPDATE that requires the
 * other side's marker to be absent and returns the row only when it won, so a
 * restore can no longer be answered "restored" while the cron deletes the
 * resource underneath it.
 */

export const pendingDeletionsRouter = new Hono<JwtContext>()

pendingDeletionsRouter.use('*', authJwt)

const requireEdit = requireRole('admin', 'editor')

/**
 * How long a cron claim is honoured. Longer than any single cron invocation
 * (maxDuration 300s), so a live run is never overtaken; a claim left behind by
 * a crashed run expires and the next run retries the (idempotent) delete.
 */
export const EXECUTION_CLAIM_LEASE_MS = 15 * 60 * 1000

/** PostgREST `or` filter: no cron claim, or one that has been abandoned. */
function unclaimedFilter(now: number): string {
  const staleBefore = new Date(now - EXECUTION_CLAIM_LEASE_MS).toISOString()
  return `execution_claimed_at.is.null,execution_claimed_at.lt.${staleBefore}`
}

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
  // A malformed id would reach Postgres as an invalid-uuid error; answer it
  // like any unknown id.
  if (!isUuid(pendingId)) throw new ApiError('NOT_FOUND', 'Pending deletion not found')

  // Load the row first so we can verify the org match before any restore work.
  const { data: row, error: loadErr } = await supabaseAdmin
    .from('pending_deletions')
    .select('id, organization_id, resource_type, resource_id, resource_snapshot, cancelled_at, executed_at')
    .eq('id', pendingId)
    .maybeSingle()

  if (loadErr) throw new ApiError('INTERNAL_ERROR', 'Failed to load pending deletion')
  if (!row) throw new ApiError('NOT_FOUND', 'Pending deletion not found')
  if (row.organization_id !== orgId) throw new ApiError('FORBIDDEN', 'Access denied')
  if (row.executed_at) {
    // Status 410 (Gone) is semantically "the resource existed but has
    // been permanently removed". The closest catalog code is NOT_FOUND
    // (404 status) — slight semantic loss but the SDK contract stays
    // typed and SpanlensApiError.code === 'NOT_FOUND' is what the
    // caller can switch on. The original message preserves the
    // "hard-deleted; cannot restore" nuance.
    throw new ApiError('NOT_FOUND', 'Already hard-deleted; cannot restore')
  }
  if (row.cancelled_at) {
    throw new ApiError('CONFLICT', 'Already restored')
  }

  // Claim first: only a row that is still active AND not claimed by a running
  // cron can be restored. Reactivating before this point is what let a restore
  // report success while the cron deleted the resource.
  const now = Date.now()
  const claimedAt = new Date(now).toISOString()
  const { data: claimed, error: claimErr } = await supabaseAdmin
    .from('pending_deletions')
    .update({ cancelled_at: claimedAt, cancelled_by: userId ?? null })
    .eq('id', pendingId)
    .eq('organization_id', orgId)
    .is('cancelled_at', null)
    .is('executed_at', null)
    .or(unclaimedFilter(now))
    .select('id')

  if (claimErr) throw new ApiError('INTERNAL_ERROR', 'Failed to mark restored')
  if (!claimed || claimed.length === 0) {
    throw new ApiError(
      'CONFLICT',
      'This deletion is already being executed or was just restored. Refresh to see its current state.',
    )
  }

  const reactivation = await reactivateByType(
    row.resource_type as PendingResourceType,
    row.resource_id,
    orgId,
    (row.resource_snapshot ?? {}) as Record<string, unknown>,
  )
  if (!reactivation.ok) {
    await releaseRestoreClaim(pendingId, claimedAt)
    throw new ApiError('CONFLICT', reactivation.error)
  }

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
 * Undo a restore claim whose reactivation failed, so the row is back in the
 * queue exactly as it was. Scoped to our own cancelled_at value so it can
 * never reopen a row someone else cancelled. Best effort: if it fails the row
 * simply stays cancelled, which is the safe direction (nothing gets deleted).
 */
async function releaseRestoreClaim(pendingId: string, claimedAt: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('pending_deletions')
    .update({ cancelled_at: null, cancelled_by: null })
    .eq('id', pendingId)
    .eq('cancelled_at', claimedAt)
  if (error) {
    console.error('[pending-deletions] failed to release restore claim', {
      pendingId,
      error: error.message,
    })
  }
}

/** Give a cron claim back after a failed hard delete so the next run retries. */
async function releaseExecutionClaim(pendingId: string, claimedAt: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('pending_deletions')
    .update({ execution_claimed_at: null })
    .eq('id', pendingId)
    .eq('execution_claimed_at', claimedAt)
  if (error) {
    // Not fatal: the lease expires and the next run picks the row up anyway.
    console.error('[pending-deletions] failed to release execution claim', {
      pendingId,
      error: error.message,
    })
  }
}

export interface PendingDeletionRunResult {
  picked: number
  executed: number
  /** Rows restored (or claimed by another run) between the batch read and our claim. */
  skipped: number
  failed: number
  errors: { id: string; error: string }[]
}

type DueRow = { id: string; organization_id: string; resource_type: string; resource_id: string }

/** Claim → hard delete → stamp, for one row. */
async function executeOne(row: DueRow): Promise<'executed' | 'skipped' | { error: string }> {
  const now = Date.now()
  const claimedAt = new Date(now).toISOString()

  const { data: claimed, error: claimErr } = await supabaseAdmin
    .from('pending_deletions')
    .update({ execution_claimed_at: claimedAt })
    .eq('id', row.id)
    .is('cancelled_at', null)
    .is('executed_at', null)
    .or(unclaimedFilter(now))
    .select('id')

  if (claimErr) return { error: claimErr.message }
  // Restored (or taken by a parallel run) after the batch was read.
  if (!claimed || claimed.length === 0) return 'skipped'

  const result = await hardDeleteByType(
    row.resource_type as PendingResourceType,
    row.resource_id,
    row.organization_id,
  )
  if (!result.ok) {
    await releaseExecutionClaim(row.id, claimedAt)
    return { error: result.error }
  }

  // Stamp against our own claim. If this write fails the claim stays, the
  // lease runs out, and the next run repeats the (idempotent) delete and
  // stamps it then.
  const { error: stampErr } = await supabaseAdmin
    .from('pending_deletions')
    .update({ executed_at: new Date().toISOString() })
    .eq('id', row.id)
    .eq('execution_claimed_at', claimedAt)
    .is('executed_at', null)

  return stampErr ? { error: stampErr.message } : 'executed'
}

/**
 * Cron-callable executor. Exported so cron.ts can call it without going
 * through the HTTP boundary. Returns a summary the cron handler can log.
 *
 * cron.ts records the run as 'error' whenever `failed > 0`, so a queue query
 * that fails is reported as one failure instead of an empty, healthy-looking
 * run. This job is the deletion-compliance path; a silent stall is the
 * failure mode that matters most.
 */
export async function executePendingDeletions(opts: {
  batchSize?: number
} = {}): Promise<PendingDeletionRunResult> {
  const batchSize = opts.batchSize ?? 100

  const { data: due, error } = await supabaseAdmin
    .from('pending_deletions')
    .select('id, organization_id, resource_type, resource_id')
    .lte('scheduled_for', new Date().toISOString())
    .is('cancelled_at', null)
    .is('executed_at', null)
    .order('scheduled_for', { ascending: true })
    .limit(batchSize)

  if (error) {
    console.error('[pending-deletions] failed to load due rows', { error: error.message })
    return {
      picked: 0,
      executed: 0,
      skipped: 0,
      failed: 1,
      errors: [{ id: 'queue', error: `Failed to load due deletions: ${error.message}` }],
    }
  }

  const rows = (due ?? []) as DueRow[]
  let executed = 0
  let skipped = 0
  const errors: { id: string; error: string }[] = []

  for (const row of rows) {
    const outcome = await executeOne(row)
    if (outcome === 'executed') executed++
    else if (outcome === 'skipped') skipped++
    else errors.push({ id: row.id, error: outcome.error })
  }

  return { picked: rows.length, executed, skipped, failed: errors.length, errors }
}
