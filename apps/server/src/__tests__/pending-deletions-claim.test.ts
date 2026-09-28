import { beforeEach, describe, expect, test, vi } from 'vitest'
import { Hono } from 'hono'
import { installOnError } from './helpers/install-on-error.js'

/**
 * Restore vs hard-delete cron on the soft-delete queue (C5.4).
 *
 * Before: the cron hard-deleted every row of a batch it had SELECTed earlier,
 * without re-checking, and restore reactivated the resource before stamping
 * cancelled_at. A restore landing mid-batch was answered "restored" while the
 * prompt version was deleted anyway. A failed queue query was also reported
 * as `failed: 0`, which the cron logged as a healthy run.
 *
 * Now each side claims the row with a conditional UPDATE and only acts when
 * the claim returned the row. These tests assert the ordering (claim before
 * side effect), the claim predicates, and the error reporting.
 */

vi.mock('../lib/db.js', async () => {
  const { recorder } = await import('./helpers/supabase-recorder.js')
  return { supabaseAdmin: recorder.client, supabaseClient: recorder.client }
})

vi.mock('../lib/pending-deletions.js', () => ({
  hardDeleteByType: vi.fn(),
  reactivateByType: vi.fn(),
}))

vi.mock('../lib/audit-log.js', () => ({
  recordAuditEvent: vi.fn(),
  recordAuditLog: vi.fn(),
  auditContextFromHono: () => ({}),
}))

vi.mock('../middleware/requireRole.js', () => import('./helpers/cached-role-gate.js'))

vi.mock('../middleware/authJwt.js', () => ({
  authJwt: async (c: { set: (k: string, v: unknown) => void }, next: () => Promise<void>) => {
    c.set('userId', USER)
    c.set('orgId', ORG)
    c.set('role', 'admin')
    return next()
  },
}))

import { recorder, usedMethod, type RecordedQuery } from './helpers/supabase-recorder.js'
import { hardDeleteByType, reactivateByType } from '../lib/pending-deletions.js'
import { executePendingDeletions, pendingDeletionsRouter } from '../api/pendingDeletions.js'

const ORG = '11111111-1111-4111-8111-111111111111'
const USER = '22222222-2222-4222-8222-222222222222'
const PENDING = '55555555-5555-4555-8555-555555555555'
const RESOURCE = '66666666-6666-4666-8666-666666666666'

const dueRow = {
  id: PENDING,
  organization_id: ORG,
  resource_type: 'prompt_version',
  resource_id: RESOURCE,
}

const activeRow = {
  ...dueRow,
  resource_snapshot: { name: 'greeting' },
  cancelled_at: null,
  executed_at: null,
}

function pendingQueries(): RecordedQuery[] {
  return recorder.queriesFor('pending_deletions')
}

function opArgs(q: RecordedQuery, method: string): unknown[][] {
  return q.ops.filter((op) => op.method === method).map((op) => op.args)
}

function restore(id = PENDING) {
  const app = new Hono()
  installOnError(app)
  app.route('/api/v1/pending-deletions', pendingDeletionsRouter)
  return app.request(`/api/v1/pending-deletions/${id}/restore`, { method: 'POST' })
}

beforeEach(() => {
  recorder.reset()
  vi.mocked(hardDeleteByType).mockReset()
  vi.mocked(reactivateByType).mockReset()
})

describe('executePendingDeletions: cron claims each row before deleting', () => {
  test('a failed queue query is reported as a failure, not an empty healthy run', async () => {
    recorder.queue('pending_deletions', { data: null, error: { message: 'statement timeout' } })

    const result = await executePendingDeletions()

    expect(result.failed).toBeGreaterThan(0)
    expect(result.errors[0]!.error).toContain('statement timeout')
    expect(hardDeleteByType).not.toHaveBeenCalled()
  })

  test('a row restored after the batch was read is skipped, not deleted', async () => {
    recorder.queue(
      'pending_deletions',
      { data: [dueRow], error: null }, // due batch
      { data: [], error: null }, // claim matched nothing: restore got there first
    )

    const result = await executePendingDeletions()

    expect(hardDeleteByType).not.toHaveBeenCalled()
    expect(result).toMatchObject({ picked: 1, executed: 0, skipped: 1, failed: 0 })
  })

  test('claims with the active + unclaimed predicate, deletes, then stamps its own claim', async () => {
    recorder.queue(
      'pending_deletions',
      { data: [dueRow], error: null },
      { data: [{ id: PENDING }], error: null },
      { data: null, error: null },
    )
    vi.mocked(hardDeleteByType).mockImplementation(async () => {
      // The claim must already have been written when the delete runs.
      expect(pendingQueries()).toHaveLength(2)
      return { ok: true }
    })

    const result = await executePendingDeletions()

    expect(result).toMatchObject({ picked: 1, executed: 1, skipped: 0, failed: 0 })
    const [, claim, stamp] = pendingQueries()
    const claimPatch = opArgs(claim!, 'update')[0]![0] as { execution_claimed_at: string }
    expect(typeof claimPatch.execution_claimed_at).toBe('string')
    expect(opArgs(claim!, 'is')).toEqual(
      expect.arrayContaining([
        ['cancelled_at', null],
        ['executed_at', null],
      ]),
    )
    expect(opArgs(claim!, 'or')[0]![0]).toMatch(/^execution_claimed_at\.is\.null,execution_claimed_at\.lt\./)
    expect(usedMethod(claim!, 'select')).toBe(true)

    expect(opArgs(stamp!, 'update')[0]![0]).toHaveProperty('executed_at')
    expect(opArgs(stamp!, 'eq')).toEqual(
      expect.arrayContaining([['execution_claimed_at', claimPatch.execution_claimed_at]]),
    )
  })

  test('a failed hard delete releases the claim so the next run retries', async () => {
    recorder.queue(
      'pending_deletions',
      { data: [dueRow], error: null },
      { data: [{ id: PENDING }], error: null },
      { data: null, error: null },
    )
    vi.mocked(hardDeleteByType).mockResolvedValue({ ok: false, error: 'fk violation' })

    const result = await executePendingDeletions()

    expect(result).toMatchObject({ executed: 0, failed: 1 })
    expect(result.errors).toEqual([{ id: PENDING, error: 'fk violation' }])
    const release = pendingQueries()[2]!
    expect(opArgs(release, 'update')[0]![0]).toEqual({ execution_claimed_at: null })
  })

  test('a failed claim query counts as a failure', async () => {
    recorder.queue(
      'pending_deletions',
      { data: [dueRow], error: null },
      { data: null, error: { message: 'connection reset' } },
    )

    const result = await executePendingDeletions()

    expect(hardDeleteByType).not.toHaveBeenCalled()
    expect(result).toMatchObject({ executed: 0, failed: 1 })
  })
})

describe('POST /pending-deletions/:id/restore: claim first, reactivate second', () => {
  test('when the cron already claimed the row, restore refuses and touches nothing', async () => {
    recorder.queue(
      'pending_deletions',
      { data: activeRow, error: null },
      { data: [], error: null },
    )

    const res = await restore()

    expect(res.status).toBe(409)
    expect(reactivateByType).not.toHaveBeenCalled()
  })

  test('reactivates only after the cancel claim is written', async () => {
    recorder.queue(
      'pending_deletions',
      { data: activeRow, error: null },
      { data: [{ id: PENDING }], error: null },
    )
    vi.mocked(reactivateByType).mockImplementation(async () => {
      expect(pendingQueries()).toHaveLength(2)
      return { ok: true, restored: 'no_op' }
    })

    const res = await restore()

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, restored: 'no_op' })
    const claim = pendingQueries()[1]!
    const patch = opArgs(claim, 'update')[0]![0] as { cancelled_at: string; cancelled_by: string }
    expect(patch.cancelled_by).toBe(USER)
    expect(opArgs(claim, 'eq')).toEqual(
      expect.arrayContaining([
        ['id', PENDING],
        ['organization_id', ORG],
      ]),
    )
    expect(opArgs(claim, 'is')).toEqual(
      expect.arrayContaining([
        ['cancelled_at', null],
        ['executed_at', null],
      ]),
    )
    expect(opArgs(claim, 'or')[0]![0]).toMatch(/^execution_claimed_at\.is\.null,/)
  })

  test('a failed reactivation hands the row back to the queue', async () => {
    recorder.queue(
      'pending_deletions',
      { data: activeRow, error: null },
      { data: [{ id: PENDING }], error: null },
      { data: null, error: null },
    )
    vi.mocked(reactivateByType).mockResolvedValue({
      ok: false,
      error: 'prompt_version already hard-deleted',
    })

    const res = await restore()

    expect(res.status).toBe(409)
    const [, claim, revert] = pendingQueries()
    const claimed = (opArgs(claim!, 'update')[0]![0] as { cancelled_at: string }).cancelled_at
    expect(opArgs(revert!, 'update')[0]![0]).toEqual({ cancelled_at: null, cancelled_by: null })
    expect(opArgs(revert!, 'eq')).toEqual(expect.arrayContaining([['cancelled_at', claimed]]))
  })

  test('a failed row lookup is a 500 rather than a misleading 404', async () => {
    recorder.queue('pending_deletions', { data: null, error: { message: 'timeout' } })

    const res = await restore()

    expect(res.status).toBe(500)
    expect(reactivateByType).not.toHaveBeenCalled()
  })

  test('a malformed id is 404 without a query', async () => {
    const res = await restore('nope')

    expect(res.status).toBe(404)
    expect(pendingQueries()).toHaveLength(0)
  })
})
