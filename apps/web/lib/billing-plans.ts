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
      'Unlimited log retention',
      'Unlimited seats',
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

export const PLAN_RETENTION_DAYS: Record<string, number> = {
  free: 14,
  starter: 90,
  team: 365,
  enterprise: 36_500,
}
