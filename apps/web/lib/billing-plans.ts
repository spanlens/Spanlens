import type { BillingPlan } from '@/lib/queries/types'

export interface PlanCardConfig {
  id: BillingPlan
  name: string
  priceUsd: number | null
  pricePeriod: string
  description: string
  features: string[]
}

export const PLANS: PlanCardConfig[] = [
  {
    id: 'free',
    name: 'Free',
    priceUsd: 0,
    pricePeriod: 'forever',
    description: 'For evaluation and small personal projects.',
    features: [
      '50,000 requests / month',
      '14-day log retention',
      '1 seat',
      '1 workspace',
      'Unlimited projects',
      'Community support',
    ],
  },
  {
    id: 'starter',
    name: 'Pro',
    priceUsd: 29,
    pricePeriod: 'per month',
    description: 'For production apps and small teams.',
    features: [
      '100,000 requests / month',
      '90-day log retention',
      '3 seats',
      '2 workspaces',
      'Unlimited projects',
      'Agent tracing',
      'Email alerts',
      'Email support',
      '+$8 / 100K extra requests',
    ],
  },
  {
    id: 'team',
    name: 'Team',
    priceUsd: 149,
    pricePeriod: 'per month',
    description: 'For growing teams with heavier workloads.',
    features: [
      '1,000,000 requests / month',
      '365-day log retention',
      '10 seats',
      '5 workspaces',
      'Unlimited projects',
      'Slack / Discord alerts',
      'Team roles & audit log',
      'Priority support',
      '+$5 / 100K extra requests',
    ],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    priceUsd: null,
    pricePeriod: 'custom',
    description: 'SSO, on-prem, custom SLAs.',
    features: [
      'Custom request volume',
      '365-day log retention (extendable by contract)',
      'Unlimited seats',
      'Unlimited workspaces',
      'SSO / SAML',
      'Dedicated Slack channel',
      'Custom SLA',
    ],
  },
]

export const PLAN_REQUEST_LIMITS: Record<string, number> = {
  free: 50_000,
  starter: 100_000,
  team: 1_000_000,
}

export const PLAN_SEAT_LIMITS: Record<string, number | null> = {
  free: 1,
  starter: 3,
  team: 10,
  enterprise: null,
}

// Max workspaces a user can OWN (be `owner_id` of). Mirrors
// `OWNED_WORKSPACE_LIMITS` in apps/server/src/lib/quota.ts — server is the
// source of truth, this is for the UI to render the limit row in
// Settings → Plan & limits without an extra fetch.
export const PLAN_WORKSPACE_LIMITS: Record<string, number | null> = {
  free: 1,
  starter: 2,
  team: 5,
  enterprise: null,
}

export const PLAN_RETENTION_DAYS: Record<string, number> = {
  free: 14,
  starter: 90,
  team: 365,
  // Default Enterprise retention — extendable per contract. Must match
  // apps/server/src/lib/quota.ts LOG_RETENTION_DAYS to keep dashboard
  // display consistent with server-enforced ClickHouse filtering.
  enterprise: 365,
}

/**
 * Display label for a plan identifier. Single source of truth for the
 * marketing name attached to each internal plan id — keeps the rename
 * `starter` → "Pro" in one place so the sidebar and settings widgets
 * agree with the billing page's plan cards.
 *
 * Falls back to capitalizing the raw id, which keeps unknown future
 * plans rendering sensibly without a hard failure.
 */
export function formatPlanLabel(planId: string | null | undefined): string {
  if (!planId) return 'Free'
  const known = PLANS.find((p) => p.id === planId)
  if (known) return known.name
  return planId.charAt(0).toUpperCase() + planId.slice(1)
}
