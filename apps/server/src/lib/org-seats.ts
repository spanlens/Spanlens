import { supabaseAdmin } from './db.js'
import { ApiError } from './errors.js'
import { SEAT_LIMITS, type Plan } from './quota.js'

/**
 * Seat policy for workspace membership (C5.2).
 *
 * A seat is a member or an unexpired pending invitation. SEAT_LIMITS in
 * quota.ts is the only table of numbers; this module decides whether they
 * apply on this instance and turns a full workspace into a clear 402.
 *
 * Where the limit is checked:
 *   - creating an invitation: members + pending invitations must be below the
 *     limit (invitations.ts)
 *   - accepting one: org_accept_invitation counts members and inserts under
 *     the org lock, so two invitees cannot both take the last seat
 *
 * Existing members are never removed: an org that is above its allowance
 * after a downgrade keeps everyone and only new joins are refused.
 */

type Env = Readonly<Record<string, string | undefined>>

const PLANS: readonly Plan[] = ['free', 'starter', 'team', 'enterprise']

/**
 * Seats are a hosted-plan lever, so they only apply where more can be bought.
 * An instance without Paddle configured (every self-hosted deployment by
 * default) has no upgrade path, and the pricing page promises self-hosting
 * has no seat limit, so enforcing there would strand a team at one seat.
 * SPANLENS_ENFORCE_SEAT_LIMITS=true|false overrides the inference.
 */
export function seatLimitsEnforced(env: Env = process.env): boolean {
  const flag = env['SPANLENS_ENFORCE_SEAT_LIMITS']?.trim().toLowerCase()
  if (flag === 'true') return true
  if (flag === 'false') return false
  return Boolean(env['PADDLE_API_KEY'])
}

/** Seat allowance for a plan on this instance. null = unlimited. */
export function seatLimitFor(plan: Plan, env: Env = process.env): number | null {
  if (!seatLimitsEnforced(env)) return null
  return SEAT_LIMITS[plan]
}

/** Customer-facing plan name. The `starter` key is sold as "Pro". */
export function planLabel(plan: Plan): string {
  if (plan === 'starter') return 'Pro'
  return plan.charAt(0).toUpperCase() + plan.slice(1)
}

function toPlan(raw: unknown): Plan {
  return PLANS.includes(raw as Plan) ? (raw as Plan) : 'free'
}

export interface OrgSeatPolicy {
  /** null when enforcement is off and the plan was never read. */
  plan: Plan | null
  /** null = unlimited. */
  limit: number | null
}

/**
 * Resolves the org's plan and seat allowance. Skips the database entirely
 * when enforcement is off. A failed lookup throws instead of defaulting, so a
 * transient error can neither block a paying team nor wave a full one through.
 */
export async function getOrgSeatPolicy(
  organizationId: string,
  env: Env = process.env,
): Promise<OrgSeatPolicy> {
  if (!seatLimitsEnforced(env)) return { plan: null, limit: null }

  const { data, error } = await supabaseAdmin
    .from('organizations')
    .select('plan')
    .eq('id', organizationId)
    .maybeSingle()

  if (error) {
    console.error('[org-seats] plan lookup failed', { organizationId, error: error.message })
    throw new ApiError('INTERNAL_ERROR', 'Failed to check the seat limit')
  }
  if (!data) throw new ApiError('NOT_FOUND', 'Organization not found')

  const plan = toPlan((data as { plan?: unknown }).plan)
  return { plan, limit: seatLimitFor(plan, env) }
}

function seats(n: number): string {
  return `${n} seat${n === 1 ? '' : 's'}`
}

/**
 * 402 for a full workspace, following the owned-workspace limit convention
 * (PAYMENT_REQUIRED + a machine-readable `reason` in details). The copy is
 * written for whoever is looking at it: the admin sending the invite can fix
 * it, the invitee can only ask.
 */
export function seatLimitError(
  policy: { plan: Plan; limit: number },
  used: number,
  audience: 'admin' | 'invitee',
): ApiError {
  const label = planLabel(policy.plan)
  const message =
    audience === 'admin'
      ? `Your ${label} plan includes ${seats(policy.limit)}, and this workspace is using ${used} ` +
        '(members plus pending invitations). Upgrade the plan, remove a member, or cancel a ' +
        'pending invitation to invite someone new.'
      : `This workspace has used every seat on its ${label} plan (${seats(policy.limit)}). Ask a ` +
        'workspace admin to upgrade the plan or free up a seat, then accept the invitation again.'

  return new ApiError('PAYMENT_REQUIRED', message, {
    reason: 'seat_limit_reached',
    plan: policy.plan,
    limit: policy.limit,
    used,
    upgrade_url: 'https://www.spanlens.io/pricing',
  })
}
