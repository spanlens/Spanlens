import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { Hono } from 'hono'
import { installOnError } from './helpers/install-on-error.js'

/**
 * Seat limits on the invitation flow (C5.2) + exact member lookup (C5.3).
 *
 * SEAT_LIMITS (Free 1 / Pro 3 / Team 10 / Enterprise unlimited) was declared,
 * advertised on the pricing page and shown as a "Hard limit" in Settings, but
 * nothing read it. These tests drive the real routers:
 *
 *   - creating an invitation counts members + unexpired pending invitations
 *   - accepting (token and id paths) hands the limit to org_accept_invitation,
 *     which counts and inserts under the org lock (SQL proven in
 *     supabase/tests/org-members-atomic.sql)
 *   - enforcement is off on instances that do not sell seats (self-hosted)
 *
 * The Supabase mock resolves failures as `{ data: null, error }` like the real
 * client, so an unchecked error shows up as a wrong status here.
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

vi.mock('../lib/resend.js', () => ({
  sendEmail: vi.fn(async () => ({ sent: true })),
  renderInvitationEmail: () => ({ subject: 'Join', html: '<p>Join</p>' }),
}))

vi.mock('../middleware/requireRole.js', () => import('./helpers/cached-role-gate.js'))

vi.mock('../middleware/authJwt.js', () => ({
  authJwt: async (
    c: { set: (k: string, v: unknown) => void; req: { header: (k: string) => string | undefined } },
    next: () => Promise<void>,
  ) => {
    c.set('userId', c.req.header('x-test-user') ?? ADMIN_USER)
    c.set('email', c.req.header('x-test-email') ?? 'admin@acme.test')
    c.set('orgId', ORG)
    c.set('role', 'admin')
    return next()
  },
}))

import { recorder, usedMethod } from './helpers/supabase-recorder.js'
import { sendEmail } from '../lib/resend.js'
import {
  invitationsRouter,
  meInvitationsRouter,
  orgInvitationsRouter,
} from '../api/invitations.js'

const ORG = '11111111-1111-4111-8111-111111111111'
const ADMIN_USER = '22222222-2222-4222-8222-222222222222'
const INVITEE_USER = '33333333-3333-4333-8333-333333333333'
const INVITATION_ID = '44444444-4444-4444-8444-444444444444'
const FUTURE = '2099-01-01T00:00:00.000Z'

function makeApp(): Hono {
  const app = new Hono()
  installOnError(app)
  app.route('/api/v1/organizations/:orgId/invitations', orgInvitationsRouter)
  app.route('/api/v1/invitations', invitationsRouter)
  app.route('/api/v1/me/pending-invitations', meInvitationsRouter)
  return app
}

function createInvite(email = 'new@acme.test') {
  return makeApp().request(`/api/v1/organizations/${ORG}/invitations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, role: 'editor' }),
  })
}

const inviteeHeaders = {
  'Content-Type': 'application/json',
  'x-test-user': INVITEE_USER,
  'x-test-email': 'invitee@acme.test',
}

function acceptByToken() {
  return makeApp().request('/api/v1/invitations/accept', {
    method: 'POST',
    headers: inviteeHeaders,
    body: JSON.stringify({ token: 'a'.repeat(64) }),
  })
}

function acceptById() {
  return makeApp().request(`/api/v1/me/pending-invitations/${INVITATION_ID}/accept`, {
    method: 'POST',
    headers: inviteeHeaders,
    body: '{}',
  })
}

const pendingInvitation = {
  id: INVITATION_ID,
  email: 'invitee@acme.test',
  role: 'viewer',
  organization_id: ORG,
  expires_at: FUTURE,
  accepted_at: null,
}

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> }
}

const savedEnv = { ...process.env }

beforeEach(() => {
  recorder.reset()
  vi.mocked(sendEmail).mockClear()
  // Hosted behaviour by default: seats are sold, so they are enforced.
  process.env.SPANLENS_ENFORCE_SEAT_LIMITS = 'true'
})

afterEach(() => {
  process.env = { ...savedEnv }
})

describe('POST /organizations/:orgId/invitations: seat limit', () => {
  test('refuses when members + pending invitations already fill the plan', async () => {
    // Pro (starter) = 3 seats: 2 members + 1 pending invite = full.
    recorder.queueRpc('org_member_emails', {
      data: [
        { user_id: ADMIN_USER, email: 'admin@acme.test' },
        { user_id: 'u2', email: 'dev@acme.test' },
      ],
      error: null,
    })
    recorder.queue(
      'org_invitations',
      { data: [], error: null }, // duplicate-pending check
      { data: null, error: null, count: 1 }, // pending seats
    )
    recorder.queue('organizations', { data: { plan: 'starter' }, error: null })

    const res = await createInvite()

    expect(res.status).toBe(402)
    const body = (await res.json()) as ErrorBody
    expect(body.error.code).toBe('PAYMENT_REQUIRED')
    expect(body.error.details).toMatchObject({
      reason: 'seat_limit_reached',
      plan: 'starter',
      limit: 3,
      used: 3,
    })
    expect(body.error.message).toContain('Pro plan')
    expect(body.error.message).not.toContain('—')
    // Nothing was created and nobody was emailed.
    expect(recorder.queriesFor('org_invitations').some((q) => usedMethod(q, 'insert'))).toBe(false)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  test('counts only unexpired, unaccepted invitations as seats', async () => {
    recorder.queueRpc('org_member_emails', {
      data: [{ user_id: ADMIN_USER, email: 'admin@acme.test' }],
      error: null,
    })
    recorder.queue(
      'org_invitations',
      { data: [], error: null },
      { data: null, error: null, count: 1 },
      { data: { id: 'inv-new', email: 'new@acme.test', role: 'editor' }, error: null },
    )
    recorder.queue(
      'organizations',
      { data: { plan: 'starter' }, error: null },
      { data: { name: 'Acme' }, error: null },
    )

    const res = await createInvite()

    expect(res.status).toBe(201)
    const countQuery = recorder.queriesFor('org_invitations')[1]!
    expect(countQuery.ops).toEqual(
      expect.arrayContaining([
        { method: 'eq', args: ['organization_id', ORG] },
        { method: 'is', args: ['accepted_at', null] },
        expect.objectContaining({ method: 'gt', args: ['expires_at', expect.any(String)] }),
      ]),
    )
    expect(sendEmail).toHaveBeenCalledTimes(1)
  })

  test('Enterprise is unlimited and skips the pending count', async () => {
    recorder.queueRpc('org_member_emails', {
      data: Array.from({ length: 40 }, (_, i) => ({ user_id: `u${i}`, email: `m${i}@acme.test` })),
      error: null,
    })
    recorder.queue(
      'org_invitations',
      { data: [], error: null },
      { data: { id: 'inv-new', email: 'new@acme.test', role: 'editor' }, error: null },
    )
    recorder.queue(
      'organizations',
      { data: { plan: 'enterprise' }, error: null },
      { data: { name: 'Acme' }, error: null },
    )

    const res = await createInvite()

    expect(res.status).toBe(201)
    expect(recorder.queriesFor('org_invitations')).toHaveLength(2)
  })

  test('self-hosted instances (no billing) never enforce seats', async () => {
    delete process.env.SPANLENS_ENFORCE_SEAT_LIMITS
    delete process.env.PADDLE_API_KEY
    recorder.queueRpc('org_member_emails', {
      data: [{ user_id: ADMIN_USER, email: 'admin@acme.test' }],
      error: null,
    })
    recorder.queue(
      'org_invitations',
      { data: [], error: null },
      { data: { id: 'inv-new', email: 'new@acme.test', role: 'editor' }, error: null },
    )
    recorder.queue('organizations', { data: { name: 'Acme' }, error: null })

    const res = await createInvite()

    expect(res.status).toBe(201)
    // Free would be full at 1 seat, but the plan was never even read.
    expect(recorder.queriesFor('organizations')).toHaveLength(1)
  })

  test('a failed pending-count query is a 500, not an uncounted pass', async () => {
    recorder.queueRpc('org_member_emails', {
      data: [{ user_id: ADMIN_USER, email: 'admin@acme.test' }],
      error: null,
    })
    recorder.queue(
      'org_invitations',
      { data: [], error: null },
      { data: null, error: { message: 'timeout' }, count: null },
    )
    recorder.queue('organizations', { data: { plan: 'team' }, error: null })

    const res = await createInvite()

    expect(res.status).toBe(500)
    expect(recorder.queriesFor('org_invitations').some((q) => usedMethod(q, 'insert'))).toBe(false)
  })
})

describe('POST /organizations/:orgId/invitations: existing-member check (C5.3)', () => {
  test('finds an existing member by email through the org, whatever its position in Auth', async () => {
    recorder.queueRpc('org_member_emails', {
      data: [
        { user_id: ADMIN_USER, email: 'admin@acme.test' },
        { user_id: 'u-late', email: 'Late.Signup@Acme.test' },
      ],
      error: null,
    })

    const res = await createInvite('late.signup@acme.test')

    expect(res.status).toBe(409)
    expect(((await res.json()) as ErrorBody).error.message).toBe(
      'This user is already a member of the organization',
    )
    expect(recorder.listUsers).not.toHaveBeenCalled()
  })

  test('a failed member lookup is a 500 instead of skipping the check', async () => {
    recorder.queueRpc('org_member_emails', { data: null, error: { message: 'boom' } })

    const res = await createInvite()

    expect(res.status).toBe(500)
    expect(sendEmail).not.toHaveBeenCalled()
  })
})

describe('accepting an invitation: the seat check runs inside the RPC', () => {
  test('token accept passes the plan limit and maps seat_limit to 402', async () => {
    recorder.queue('org_invitations', { data: pendingInvitation, error: null })
    recorder.queue('organizations', { data: { plan: 'starter' }, error: null })
    recorder.queueRpc('org_accept_invitation', {
      data: { status: 'seat_limit', organization_id: ORG, members: 3, seat_limit: 3 },
      error: null,
    })

    const res = await acceptByToken()

    expect(res.status).toBe(402)
    const body = (await res.json()) as ErrorBody
    expect(body.error.code).toBe('PAYMENT_REQUIRED')
    expect(body.error.details).toMatchObject({ reason: 'seat_limit_reached', limit: 3, used: 3 })
    expect(body.error.message).toContain('Ask a workspace admin')
    expect(recorder.rpcCalls).toEqual([
      {
        fn: 'org_accept_invitation',
        args: { p_invitation_id: INVITATION_ID, p_user_id: INVITEE_USER, p_seat_limit: 3 },
      },
    ])
    // Nothing joined, so onboarding must not be skipped either.
    expect(recorder.queriesFor('user_profiles')).toHaveLength(0)
    // The member row is only ever written by the RPC.
    expect(recorder.queriesFor('org_members')).toHaveLength(0)
  })

  test('token accept joins and returns the organization', async () => {
    recorder.queue('org_invitations', { data: pendingInvitation, error: null })
    recorder.queue('organizations', { data: { plan: 'team' }, error: null })
    recorder.queueRpc('org_accept_invitation', {
      data: { status: 'joined', organization_id: ORG, role: 'viewer' },
      error: null,
    })

    const res = await acceptByToken()

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, data: { organizationId: ORG, role: 'viewer' } })
    expect(recorder.rpcCalls[0]!.args).toMatchObject({ p_seat_limit: 10 })
    expect(recorder.queriesFor('user_profiles')).toHaveLength(1)
  })

  test('Enterprise passes no limit', async () => {
    recorder.queue('org_invitations', { data: pendingInvitation, error: null })
    recorder.queue('organizations', { data: { plan: 'enterprise' }, error: null })
    recorder.queueRpc('org_accept_invitation', {
      data: { status: 'joined', organization_id: ORG, role: 'viewer' },
      error: null,
    })

    const res = await acceptByToken()

    expect(res.status).toBe(200)
    expect(recorder.rpcCalls[0]!.args).toMatchObject({ p_seat_limit: null })
  })

  test('a concurrent accept that won the race surfaces as already accepted', async () => {
    recorder.queue('org_invitations', { data: pendingInvitation, error: null })
    recorder.queue('organizations', { data: { plan: 'team' }, error: null })
    recorder.queueRpc('org_accept_invitation', {
      data: { status: 'already_accepted', organization_id: ORG },
      error: null,
    })

    const res = await acceptByToken()

    expect(res.status).toBe(400)
    expect(((await res.json()) as ErrorBody).error.message).toBe('Invitation already accepted')
  })

  test('an RPC failure is a 500', async () => {
    recorder.queue('org_invitations', { data: pendingInvitation, error: null })
    recorder.queue('organizations', { data: { plan: 'team' }, error: null })
    recorder.queueRpc('org_accept_invitation', { data: null, error: { message: 'deadlock' } })

    const res = await acceptByToken()

    expect(res.status).toBe(500)
    expect(recorder.queriesFor('user_profiles')).toHaveLength(0)
  })

  test('id accept goes through the same seat-checked RPC', async () => {
    recorder.queue('org_invitations', { data: pendingInvitation, error: null })
    recorder.queue('organizations', { data: { plan: 'free' }, error: null })
    recorder.queueRpc('org_accept_invitation', {
      data: { status: 'seat_limit', organization_id: ORG, members: 1, seat_limit: 1 },
      error: null,
    })

    const res = await acceptById()

    expect(res.status).toBe(402)
    expect(((await res.json()) as ErrorBody).error.details).toMatchObject({
      reason: 'seat_limit_reached',
      plan: 'free',
      limit: 1,
    })
    expect(recorder.rpcCalls[0]).toEqual({
      fn: 'org_accept_invitation',
      args: { p_invitation_id: INVITATION_ID, p_user_id: INVITEE_USER, p_seat_limit: 1 },
    })
    expect(recorder.queriesFor('org_members')).toHaveLength(0)
  })

  test('id accept: existing member is idempotent and returns the org', async () => {
    recorder.queue('org_invitations', { data: pendingInvitation, error: null })
    recorder.queue('organizations', { data: { plan: 'free' }, error: null })
    recorder.queueRpc('org_accept_invitation', {
      data: { status: 'already_member', organization_id: ORG, role: 'viewer' },
      error: null,
    })

    const res = await acceptById()

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, data: { organizationId: ORG, role: 'viewer' } })
  })
})
