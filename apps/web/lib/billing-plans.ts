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
      '10,000 requests / month',
      '7-day log retention',
      '1 project',
      'Community support',
    ],
  },
  {
    id: 'starter',
    name: 'Starter',
    priceUsd: 19,
    pricePeriod: 'per month',
    description: 'For production apps and small teams.',
    features: [
      '100,000 requests / month',
      '30-day log retention',
      'Up to 5 projects',
      'Agent tracing',
      'Email alerts',
      'Email support',
    ],
  },
  {
    id: 'team',
    name: 'Team',
    priceUsd: 49,
    pricePeriod: 'per month',
    description: 'For growing teams with heavier workloads.',
    features: [
      '500,000 requests / month',
      '90-day log retention',
      'Unlimited projects',
      'Slack / Discord alerts',
      'Team roles & audit log',
      'Priority support',
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
      '1-year log retention',
      'SSO / SAML',
      'Dedicated Slack channel',
      'Custom SLA',
    ],
  },
]

export const PLAN_REQUEST_LIMITS: Record<string, number> = {
  free: 10_000,
  starter: 100_000,
  team: 500_000,
}
