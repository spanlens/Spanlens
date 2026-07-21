import { supabaseAdmin } from './db.js'
import { invalidatePromptName } from './prompt-cache.js'

/**
 * Shared helpers for the soft-delete queue.
 *
 * Two responsibilities:
 *   1. Queue: a row is added when the user "deletes" a resource, the
 *      resource is immediately deactivated (proxy traffic stops), and the
 *      hard delete is deferred ~72 hours.
 *   2. Execute: the cron handler walks `scheduled_for` and calls
 *      `hardDeleteByType()` for each due row, then stamps `executed_at`.
 *
 * The restore path lives in apps/server/src/api/pendingDeletions.ts.
 *
 * NOTE (2026-07-21): api_key and provider_key deletes are now immediate hard
 * deletes (see apiKeys.ts / providerKeys.ts) — new enqueues only come from
 * prompt_version. The api_key / provider_key branches below stay so the cron
 * can drain rows queued before the switch and the restore path keeps working
 * for them during their remaining grace window.
 */

export type PendingResourceType = 'api_key' | 'provider_key' | 'prompt_version'

/** Default grace period before a queued delete becomes irreversible. */
export const PENDING_DELETION_GRACE_HOURS = 72

/**
 * Hard delete the underlying row. Called by the cron once the grace window
 * has elapsed, AND by the restore path's no-op cleanup when restoring an
 * already-executed deletion (which is a no-op apart from logging).
 */
export async function hardDeleteByType(
  resourceType: PendingResourceType,
  resourceId: string,
  organizationId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  switch (resourceType) {
    case 'api_key': {
      const { error } = await supabaseAdmin
        .from('api_keys')
        .delete()
        .eq('id', resourceId)
      return error ? { ok: false, error: error.message } : { ok: true }
    }

    case 'provider_key': {
      const { error } = await supabaseAdmin
        .from('provider_keys')
        .delete()
        .eq('id', resourceId)
        .eq('organization_id', organizationId)
      return error ? { ok: false, error: error.message } : { ok: true }
    }

    case 'prompt_version': {
      // We need the prompt name BEFORE deleting so we can invalidate the
      // resolve cache. If the row is already gone (e.g. a manual cleanup),
      // we still try the delete to keep the operation idempotent.
      const { data: row } = await supabaseAdmin
        .from('prompt_versions')
        .select('name')
        .eq('id', resourceId)
        .eq('organization_id', organizationId)
        .maybeSingle()

      const { error } = await supabaseAdmin
        .from('prompt_versions')
        .delete()
        .eq('id', resourceId)
        .eq('organization_id', organizationId)
      if (error) return { ok: false, error: error.message }

      if (row?.name) await invalidatePromptName(organizationId, row.name)
      return { ok: true }
    }
  }
}

/**
 * Restore the deactivation a soft-delete did to the source row. Each
 * resource type has its own reactivation contract:
 *   • api_key       → flip is_active back to true
 *   • provider_key  → flip is_active back to true
 *   • prompt_version → no-op (the row was never modified, only the
 *                      pending_deletions row pointed at it)
 *
 * Returns { ok: false, ... } when the source row no longer exists (i.e.
 * cron already hard-deleted). The caller should still mark the pending row
 * cancelled so the UI clears it.
 */
export async function reactivateByType(
  resourceType: PendingResourceType,
  resourceId: string,
  organizationId: string,
  snapshot: Record<string, unknown>,
): Promise<{ ok: true; restored: 'reactivated' | 'recreated' | 'no_op' } | { ok: false; error: string }> {
  switch (resourceType) {
    case 'api_key': {
      // Confirm the row still exists; if cron already hard-deleted, we'd
      // need to recreate from snapshot. That recreation path is intentionally
      // disabled in this version — recreating an api_key from snapshot would
      // re-introduce the original sha256 key_hash, which the user has long
      // since lost the plaintext for. They should issue a fresh key instead.
      const { data: existing } = await supabaseAdmin
        .from('api_keys')
        .select('id')
        .eq('id', resourceId)
        .maybeSingle()
      if (!existing) {
        return { ok: false, error: 'api_key already hard-deleted; issue a new key' }
      }
      const { error } = await supabaseAdmin
        .from('api_keys')
        .update({ is_active: true })
        .eq('id', resourceId)
      return error
        ? { ok: false, error: error.message }
        : { ok: true, restored: 'reactivated' }
    }

    case 'provider_key': {
      const { data: existing } = await supabaseAdmin
        .from('provider_keys')
        .select('id')
        .eq('id', resourceId)
        .eq('organization_id', organizationId)
        .maybeSingle()
      if (!existing) {
        return {
          ok: false,
          error: 'provider_key already hard-deleted; re-add it from the dashboard',
        }
      }
      const { error } = await supabaseAdmin
        .from('provider_keys')
        .update({ is_active: true })
        .eq('id', resourceId)
        .eq('organization_id', organizationId)
      return error
        ? { ok: false, error: error.message }
        : { ok: true, restored: 'reactivated' }
    }

    case 'prompt_version': {
      // prompt_versions are immutable; the soft delete did not modify the
      // row, only enqueued a future hard delete. Restoring is a no-op.
      // If the row is already gone, we cannot recreate it (snapshot is
      // sufficient data but it would re-introduce a UUID that may collide
      // with other state). Log via the snapshot field.
      const { data: existing } = await supabaseAdmin
        .from('prompt_versions')
        .select('id, name')
        .eq('id', resourceId)
        .eq('organization_id', organizationId)
        .maybeSingle()
      if (!existing) {
        return {
          ok: false,
          error: 'prompt_version already hard-deleted',
        }
      }
      // Best effort: ensure the resolve cache forgets any stale entry that
      // may have been populated during the grace window.
      if (typeof snapshot.name === 'string') {
        await invalidatePromptName(organizationId, snapshot.name)
      } else if (existing.name) {
        await invalidatePromptName(organizationId, existing.name)
      }
      return { ok: true, restored: 'no_op' }
    }
  }
}

/**
 * Enqueue a soft delete: stamps a pending_deletions row and flips the
 * source row's `is_active` so traffic stops immediately. Returns the
 * pending row id + the absolute timestamp at which cron will hard-delete.
 *
 * If the resource is already queued (UNIQUE WHERE active), returns a
 * { ok: false, code: 'ALREADY_PENDING' } sentinel so the API can map it
 * to a 409.
 *
 * Resource-side deactivation:
 *   • api_key / provider_key  → set is_active = false
 *   • prompt_version           → no-op (immutable; cache invalidate suffices)
 */
export async function enqueueDeletion(opts: {
  organizationId: string
  resourceType: PendingResourceType
  resourceId: string
  resourceSnapshot: Record<string, unknown>
  requestedBy: string | null
  graceHours?: number
}): Promise<
  | { ok: true; pendingId: string; scheduledFor: string }
  | { ok: false; code: 'ALREADY_PENDING' | 'INSERT_FAILED'; error?: string }
> {
  const grace = opts.graceHours ?? PENDING_DELETION_GRACE_HOURS
  const scheduledFor = new Date(Date.now() + grace * 3_600_000).toISOString()

  // Deactivate source first so traffic stops immediately. We do this BEFORE
  // queueing so a queue-insert failure leaves the user's data untouched —
  // they retry with a fresh attempt instead of being stuck with an
  // active+queued row.
  const deactivation = await deactivateSource(
    opts.resourceType,
    opts.resourceId,
    opts.organizationId,
  )
  if (!deactivation.ok) {
    return { ok: false, code: 'INSERT_FAILED', error: deactivation.error }
  }

  const { data, error } = await supabaseAdmin
    .from('pending_deletions')
    .insert({
      organization_id: opts.organizationId,
      resource_type: opts.resourceType,
      resource_id: opts.resourceId,
      resource_snapshot: opts.resourceSnapshot,
      requested_by: opts.requestedBy,
      scheduled_for: scheduledFor,
    })
    .select('id, scheduled_for')
    .single()

  if (error) {
    // Roll back deactivation so the user can retry without a manual
    // is_active=true update via support.
    await reactivateByType(
      opts.resourceType,
      opts.resourceId,
      opts.organizationId,
      opts.resourceSnapshot,
    )

    // Postgres unique violation
    if (error.code === '23505') {
      return { ok: false, code: 'ALREADY_PENDING' }
    }
    return { ok: false, code: 'INSERT_FAILED', error: error.message }
  }
  if (!data) {
    return { ok: false, code: 'INSERT_FAILED', error: 'no row returned' }
  }

  return { ok: true, pendingId: data.id, scheduledFor: data.scheduled_for }
}

async function deactivateSource(
  resourceType: PendingResourceType,
  resourceId: string,
  organizationId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  switch (resourceType) {
    case 'api_key': {
      const { error } = await supabaseAdmin
        .from('api_keys')
        .update({ is_active: false })
        .eq('id', resourceId)
      return error ? { ok: false, error: error.message } : { ok: true }
    }
    case 'provider_key': {
      const { error } = await supabaseAdmin
        .from('provider_keys')
        .update({ is_active: false })
        .eq('id', resourceId)
        .eq('organization_id', organizationId)
      return error ? { ok: false, error: error.message } : { ok: true }
    }
    case 'prompt_version': {
      // Immutable; no source-side flip needed. The pending_deletions row
      // is the only thing standing between the version and oblivion.
      return { ok: true }
    }
  }
}
