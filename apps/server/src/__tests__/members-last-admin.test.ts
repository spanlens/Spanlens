import { beforeEach, describe, expect, test, vi } from 'vitest'
import { Hono } from 'hono'
import { installOnError } from './helpers/install-on-error.js'

/**
 * members.ts through the real router (C5.1 / C5.3).
 *
 * The previous version of this file re-implemented the last-admin predicate
 * and tested the copy, so it could not notice that the route counted admins
 * in one request and wrote in another: two admins demoting each other both
 * read "2 admins" and the workspace ended with none. The check now lives in
 * one SQL function that locks the org (org_change_member_role /
 * org_remove_member, proven against Postgres in
 * supabase/tests/org-members-atomic.sql). These tests pin the route side:
 * it delegates to those RPCs, maps every status, checks errors, and never
 * falls back to a separate read-then-write.
 */

vi.mock('../lib/db.js', async () => {
  const { recorder } = await import('./helpers/supabase-recorder.js')
  return { supabaseAdmin: recorder.client, supabaseClient: recorder.client }
})

vi.mock('../lib/audit-log.js', () => ({
  recordAuditEvent: vi.fn(),
  recordAuditLog: vi.fn(),
  auditContextFromHono: () => ({}),
}))

vi.mock('../middleware/requireRole.js', () => import('./helpers/cached-role-gate.js'))

vi.mock('../middleware/authJwt.js', () => ({
  authJwt: async (
    c: { set: (k: string, v: unknown) => void; req: { header: (k: string) => string | undefined } },
    next: () => Promise<void>,
  ) => {
    c.set('userId', 'caller-user')
    c.set('orgId', ORG)
    c.set('role', c.req.header('x-test-role') ?? 'admin')
    return next()
  },
  invalidateAuthCacheForUser: vi.fn(() => 0),
}))

import { recorder, usedMethod } from './helpers/supabase-recorder.js'
import { recordAuditEvent } from '../lib/audit-log.js'
import { membersRouter } from '../api/members.js'

const ORG = '11111111-1111-4111-8111-111111111111'
const MEMBER = '22222222-2222-4222-8222-222222222222'

function makeApp(): Hono {
  const app = new Hono()
  installOnError(app)
  app.route('/api/v1/organizations/:orgId/members', membersRouter)
  return app
}

function patchRole(role: string, userId = MEMBER, headers: Record<string, string> = {}) {
  return makeApp().request(`/api/v1/organizations/${ORG}/members/${userId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ role }),
  })
}

function removeMember(userId = MEMBER) {
  return makeApp().request(`/api/v1/organizations/${ORG}/members/${userId}`, { method: 'DELETE' })
}

/** The route must not touch org_members with a write of its own. */
function expectNoDirectMemberWrites(): void {
  for (const q of recorder.queriesFor('org_members')) {
    expect(usedMethod(q, 'update')).toBe(false)
    expect(usedMethod(q, 'delete')).toBe(false)
  }
}

beforeEach(() => {
  recorder.reset()
  vi.mocked(recordAuditEvent).mockClear()
})

describe('PATCH /members/:userId: role change goes through one locked RPC', () => {
  test('refuses to demote the last admin with the existing 400 contract', async () => {
    recorder.queueRpc('org_change_member_role', {
      data: { status: 'last_admin', previous_role: 'admin' },
      error: null,
    })

    const res = await patchRole('editor')

    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('BAD_REQUEST')
    expect(body.error.message).toBe('Cannot demote the last admin')
    expect(recorder.rpcCalls).toEqual([
      {
        fn: 'org_change_member_role',
        args: { p_org_id: ORG, p_user_id: MEMBER, p_new_role: 'editor' },
      },
    ])
    expectNoDirectMemberWrites()
    expect(recordAuditEvent).not.toHaveBeenCalled()
  })

  test('applies the change and audits the previous role', async () => {
    recorder.queueRpc('org_change_member_role', {
      data: { status: 'ok', previous_role: 'admin' },
      error: null,
    })

    const res = await patchRole('viewer')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, data: { role: 'viewer' } })
    expectNoDirectMemberWrites()
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'member.role_change',
        resourceId: MEMBER,
        metadata: { previous_role: 'admin', new_role: 'viewer' },
      }),
    )
  })

  test('same role is a no-op that is not audited', async () => {
    recorder.queueRpc('org_change_member_role', {
      data: { status: 'unchanged', previous_role: 'editor' },
      error: null,
    })

    const res = await patchRole('editor')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, data: { role: 'editor' } })
    expect(recordAuditEvent).not.toHaveBeenCalled()
  })

  test('unknown member is 404', async () => {
    recorder.queueRpc('org_change_member_role', { data: { status: 'not_found' }, error: null })

    const res = await patchRole('viewer')

    expect(res.status).toBe(404)
    expect(((await res.json()) as { error: { message: string } }).error.message).toBe('Member not found')
  })

  test('an RPC failure (resolved { error }) is a 500, never a silent success', async () => {
    recorder.queueRpc('org_change_member_role', {
      data: null,
      error: { message: 'connection reset', code: '08006' },
    })

    const res = await patchRole('viewer')

    expect(res.status).toBe(500)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('INTERNAL_ERROR')
    expect(recordAuditEvent).not.toHaveBeenCalled()
  })

  test('malformed user id is 404 without reaching the database', async () => {
    const res = await patchRole('viewer', 'not-a-uuid')

    expect(res.status).toBe(404)
    expect(recorder.rpcCalls).toHaveLength(0)
  })

  test('invalid role is rejected before the RPC', async () => {
    const res = await patchRole('owner')

    expect(res.status).toBe(400)
    expect(recorder.rpcCalls).toHaveLength(0)
  })

  test('non-admin callers are refused by requireRole', async () => {
    const res = await patchRole('viewer', MEMBER, { 'x-test-role': 'editor' })

    expect(res.status).toBe(403)
    expect(recorder.rpcCalls).toHaveLength(0)
  })
})

describe('DELETE /members/:userId: removal goes through one locked RPC', () => {
  test('refuses to remove the last admin with the existing 400 contract', async () => {
    recorder.queueRpc('org_remove_member', {
      data: { status: 'last_admin', removed_role: 'admin' },
      error: null,
    })

    const res = await removeMember()

    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: { message: string } }).error.message).toBe(
      'Cannot remove the last admin',
    )
    expect(recorder.rpcCalls).toEqual([
      { fn: 'org_remove_member', args: { p_org_id: ORG, p_user_id: MEMBER } },
    ])
    expectNoDirectMemberWrites()
  })

  test('removes the member and audits the removed role', async () => {
    recorder.queueRpc('org_remove_member', {
      data: { status: 'ok', removed_role: 'editor' },
      error: null,
    })

    const res = await removeMember()

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true })
    expectNoDirectMemberWrites()
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'member.remove', metadata: { removed_role: 'editor' } }),
    )
  })

  test('unknown member is 404', async () => {
    recorder.queueRpc('org_remove_member', { data: { status: 'not_found' }, error: null })

    const res = await removeMember()

    expect(res.status).toBe(404)
  })

  test('an RPC failure is a 500', async () => {
    recorder.queueRpc('org_remove_member', { data: null, error: { message: 'boom' } })

    const res = await removeMember()

    expect(res.status).toBe(500)
    expect(recordAuditEvent).not.toHaveBeenCalled()
  })
})

describe('GET /members: emails come from the org, not page one of every Auth user', () => {
  const roster = [
    { user_id: MEMBER, role: 'admin', invited_by: null, created_at: '2026-09-01T00:00:00Z' },
    { user_id: 'caller-user', role: 'editor', invited_by: MEMBER, created_at: '2026-09-02T00:00:00Z' },
  ]

  test('resolves every member email through org_member_emails', async () => {
    recorder.queue('org_members', { data: roster, error: null })
    recorder.queueRpc('org_member_emails', {
      data: [
        { user_id: MEMBER, email: 'owner@acme.test' },
        { user_id: 'caller-user', email: 'dev@acme.test' },
      ],
      error: null,
    })

    const res = await makeApp().request(`/api/v1/organizations/${ORG}/members`)

    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { userId: string; email: string }[] }
    expect(body.data.map((m) => m.email)).toEqual(['owner@acme.test', 'dev@acme.test'])
    expect(recorder.rpcCalls).toEqual([{ fn: 'org_member_emails', args: { p_org_id: ORG } }])
    // The project-wide first page is exactly what hid members past signup #200.
    expect(recorder.listUsers).not.toHaveBeenCalled()
  })

  test('an email lookup failure is surfaced, not rendered as "(unknown)"', async () => {
    recorder.queue('org_members', { data: roster, error: null })
    recorder.queueRpc('org_member_emails', { data: null, error: { message: 'permission denied' } })

    const res = await makeApp().request(`/api/v1/organizations/${ORG}/members`)

    expect(res.status).toBe(500)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('INTERNAL_ERROR')
  })
})
