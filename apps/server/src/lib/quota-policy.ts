import type { Plan } from './quota.js'

/**
 * Pure Pattern C quota policy decision.
 *
 * Observes: (used, limit, plan, allow_overage, cap_multiplier)
 * Decides: pass / block-with-reason.
 *
 * Split from quota.ts so tests can exercise the full decision matrix
 * without booting db.ts.
 */

export type QuotaBlockReason =
  /** Free plan over soft limit — upgrade to continue. */
  | 'free_limit'
  /** Paid plan, overage disabled by user, over soft limit. */
  | 'overage_disabled'
  /** Paid plan, overage enabled, but hit the hard cap multiplier. */
  | 'hard_cap'

export type QuotaDecision =
  | { action: 'pass'; overageActive: boolean }
  | { action: 'block'; reason: QuotaBlockReason }

export interface QuotaPolicyInput {
  used: number
  limit: number | null
  plan: Plan
  allowOverage: boolean
  capMultiplier: number
}

export function evaluateQuotaPolicy(input: QuotaPolicyInput): QuotaDecision {
  const { used, limit, plan, allowOverage, capMultiplier } = input

  // Unlimited plans (enterprise) always pass.
  if (limit === null) return { action: 'pass', overageActive: false }

  // Under the soft limit — normal operation.
  if (used < limit) return { action: 'pass', overageActive: false }

  // Over the soft limit — policy depends on plan + org settings.
  if (plan === 'free') return { action: 'block', reason: 'free_limit' }
  if (!allowOverage) return { action: 'block', reason: 'overage_disabled' }

  const hardCap = limit * capMultiplier
  if (used >= hardCap) return { action: 'block', reason: 'hard_cap' }

  return { action: 'pass', overageActive: true }
}

/** Convenience: the 429 response message for each block reason. */
export function blockMessage(reason: QuotaBlockReason): string {
  if (reason === 'free_limit') {
    return 'Monthly request quota reached on the Free plan. Upgrade to continue.'
  }
  if (reason === 'overage_disabled') {
    return 'Monthly request quota reached and overage billing is disabled for this organization.'
  }
  return 'Request blocked: hard cap on overage usage reached.'
}
