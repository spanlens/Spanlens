/**
 * Log the billing states that are consistent but need a human
 * (review of the 2026-09-28 billing fixes, C4.2 follow-up).
 *
 * Since migration 20260929110000 an org's plan is recomputed from its live
 * subscriptions instead of being forced to 'free' on a cancel, refund or
 * past-due downgrade. Migration 20260929110400 made the recompute ignore live
 * rows that look stale (period long over, or a different Paddle customer) and
 * report what it did. Three outcomes are worth a log line:
 *
 *   duplicate_live_subscription   ERROR  a new subscription was created for an
 *                                        org that already pays for another one.
 *                                        The customer is billed twice until
 *                                        someone cancels and refunds one.
 *   plan_kept_by_sibling          WARN   an entitlement was removed but another
 *                                        live subscription kept the org paid.
 *                                        Correct for a real sibling, so it is
 *                                        a warning, but it is the path by which
 *                                        a stale row would grant unpaid access.
 *   stale_live_subscription_ignored WARN live rows the recompute did not trust.
 *                                        They should be canceled in the table.
 *
 * Every function here only logs; none of these states changes the response.
 */

import { logError, logWarn } from './structured-logger.js'

export type PlanTrigger = 'subscription_event' | 'refund' | 'past_due_downgrade'

export interface PlanResolution {
  /** The org plan the database wrote, or null when it did not recompute. */
  orgPlan: string | null
  /** paddle_subscription_id the plan came from; null for free. */
  planSource: string | null
  /** Live rows the recompute ignored as stale. */
  ignoredLive: readonly string[]
}

export interface PlanResolutionReport extends PlanResolution {
  trigger: PlanTrigger
  orgId: string
  /** The subscription the event, refund or downgrade was about. */
  paddleSubscriptionId: string | null
  /** True when this step took an entitlement away (cancel, refund, downgrade). */
  entitlementRemoved: boolean
  /** Other live subscriptions, set only when this step CREATED the row. */
  duplicateOf?: readonly string[]
  /** Extra context for the log line (event id, adjustment id, ...). */
  context?: Record<string, unknown>
}

export function parseStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/** Read the plan fields the billing RPCs return (all optional on the wire). */
export function parsePlanResolution(data: unknown, planKey: 'org_plan' | 'to_plan'): PlanResolution {
  const row = (data ?? {}) as Record<string, unknown>
  return {
    orgPlan: stringOrNull(row[planKey]),
    planSource: stringOrNull(row['plan_source']),
    ignoredLive: parseStringList(row['ignored_live_subscriptions']),
  }
}

export function reportPlanResolution(report: PlanResolutionReport): void {
  const base = {
    trigger: report.trigger,
    orgId: report.orgId,
    paddleSubscriptionId: report.paddleSubscriptionId,
    ...(report.context ?? {}),
  }

  if (report.duplicateOf && report.duplicateOf.length > 0) {
    logError('BILLING_ANOMALY', {
      ...base,
      reason: 'duplicate_live_subscription',
      otherLiveSubscriptions: [...report.duplicateOf],
      action: 'Check Paddle for two active subscriptions on this workspace; cancel and refund the extra one.',
    })
  }

  const keptBySibling =
    report.entitlementRemoved &&
    report.orgPlan !== null &&
    report.orgPlan !== 'free' &&
    report.planSource !== report.paddleSubscriptionId
  if (keptBySibling) {
    logWarn('BILLING_ANOMALY', {
      ...base,
      reason: 'plan_kept_by_sibling',
      orgPlan: report.orgPlan,
      planSource: report.planSource,
    })
  }

  if (report.ignoredLive.length > 0) {
    logWarn('BILLING_ANOMALY', {
      ...base,
      reason: 'stale_live_subscription_ignored',
      ignoredLiveSubscriptions: [...report.ignoredLive],
      action: 'Confirm in Paddle and set these subscriptions rows to canceled.',
    })
  }
}
