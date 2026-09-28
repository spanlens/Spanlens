import { supabaseAdmin } from './db.js'
import { ApiError } from './errors.js'
import type { OrgRole } from '../middleware/authJwt.js'

/**
 * Typed wrappers for the membership RPCs in
 * supabase/migrations/20260929130000_org_members_atomic_ops.sql.
 *
 * Every roster decision (last-admin protection, seat check) is made inside one
 * SQL function under an org-scoped lock, because a read in one request and a
 * write in the next is exactly what let two admins demote each other to zero
 * (C5.1). Routes call these instead of touching org_members directly.
 *
 * supabase-js resolves a failed RPC to `{ data: null, error }` rather than
 * rejecting, so each wrapper checks `error` and also rejects a payload whose
 * status it does not recognise. Either case throws INTERNAL_ERROR with the
 * route's message; the database detail goes to the server log only.
 */

const ROLES: readonly OrgRole[] = ['admin', 'editor', 'viewer']

interface RpcPayload {
  status?: unknown
  previous_role?: unknown
  removed_role?: unknown
  organization_id?: unknown
  role?: unknown
  members?: unknown
}

function toRole(raw: unknown): OrgRole | null {
  return ROLES.includes(raw as OrgRole) ? (raw as OrgRole) : null
}

async function callRpc(
  fn: string,
  args: Record<string, unknown>,
  failureMessage: string,
): Promise<RpcPayload> {
  const { data, error } = await supabaseAdmin.rpc(fn, args)
  if (error || !data || typeof data !== 'object') {
    console.error(`[org-members] ${fn} failed`, {
      error: (error as { message?: string } | null)?.message ?? 'empty result',
    })
    throw new ApiError('INTERNAL_ERROR', failureMessage)
  }
  return data as RpcPayload
}

function unexpected(fn: string, payload: RpcPayload, failureMessage: string): never {
  console.error(`[org-members] ${fn} returned an unknown status`, { status: payload.status })
  throw new ApiError('INTERNAL_ERROR', failureMessage)
}

export type RoleChangeOutcome =
  | { status: 'ok' | 'unchanged'; previousRole: OrgRole }
  | { status: 'not_found' | 'last_admin' }

export async function changeMemberRole(
  organizationId: string,
  userId: string,
  newRole: OrgRole,
): Promise<RoleChangeOutcome> {
  const failure = 'Failed to update role'
  const payload = await callRpc(
    'org_change_member_role',
    { p_org_id: organizationId, p_user_id: userId, p_new_role: newRole },
    failure,
  )
  const previousRole = toRole(payload.previous_role)
  switch (payload.status) {
    case 'not_found':
    case 'last_admin':
      return { status: payload.status }
    case 'ok':
    case 'unchanged':
      if (previousRole) return { status: payload.status, previousRole }
      break
  }
  return unexpected('org_change_member_role', payload, failure)
}

export type RemoveMemberOutcome =
  | { status: 'ok'; removedRole: OrgRole }
  | { status: 'not_found' | 'last_admin' }

export async function removeMember(
  organizationId: string,
  userId: string,
): Promise<RemoveMemberOutcome> {
  const failure = 'Failed to remove member'
  const payload = await callRpc(
    'org_remove_member',
    { p_org_id: organizationId, p_user_id: userId },
    failure,
  )
  const removedRole = toRole(payload.removed_role)
  switch (payload.status) {
    case 'not_found':
    case 'last_admin':
      return { status: payload.status }
    case 'ok':
      if (removedRole) return { status: 'ok', removedRole }
      break
  }
  return unexpected('org_remove_member', payload, failure)
}

export type AcceptInvitationOutcome =
  | { status: 'joined' | 'already_member'; organizationId: string; role: OrgRole }
  | { status: 'seat_limit'; organizationId: string; members: number }
  | { status: 'not_found' | 'already_accepted' | 'expired' }

/**
 * Joins the invitee to the org and marks the invitation accepted, in one
 * transaction. `seatLimit` null = unlimited; otherwise a NEW member is only
 * inserted while the org has fewer members than that.
 */
export async function acceptInvitation(
  invitationId: string,
  userId: string,
  seatLimit: number | null,
): Promise<AcceptInvitationOutcome> {
  const failure = 'Failed to accept invitation'
  const payload = await callRpc(
    'org_accept_invitation',
    { p_invitation_id: invitationId, p_user_id: userId, p_seat_limit: seatLimit },
    failure,
  )
  const organizationId = typeof payload.organization_id === 'string' ? payload.organization_id : null
  const role = toRole(payload.role)
  switch (payload.status) {
    case 'not_found':
    case 'already_accepted':
    case 'expired':
      return { status: payload.status }
    case 'seat_limit':
      if (organizationId) {
        return { status: 'seat_limit', organizationId, members: Number(payload.members ?? 0) }
      }
      break
    case 'joined':
    case 'already_member':
      if (organizationId && role) return { status: payload.status, organizationId, role }
      break
  }
  return unexpected('org_accept_invitation', payload, failure)
}

export interface MemberEmail {
  userId: string
  email: string | null
}

/**
 * Auth emails for exactly this org's members. Replaces
 * `auth.admin.listUsers({ perPage: 200 })`, which returned the first page of
 * the whole Auth project: past 200 signups, members showed as "(unknown)" and
 * the invite dedup missed existing members (C5.3).
 */
export async function listMemberEmails(
  organizationId: string,
  failureMessage: string,
): Promise<MemberEmail[]> {
  const { data, error } = await supabaseAdmin.rpc('org_member_emails', { p_org_id: organizationId })
  if (error || !Array.isArray(data)) {
    console.error('[org-members] org_member_emails failed', {
      error: (error as { message?: string } | null)?.message ?? 'non-array result',
    })
    throw new ApiError('INTERNAL_ERROR', failureMessage)
  }
  return (data as { user_id: string; email: string | null }[]).map((row) => ({
    userId: row.user_id,
    email: row.email ?? null,
  }))
}
