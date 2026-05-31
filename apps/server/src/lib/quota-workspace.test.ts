import { describe, expect, test } from 'vitest'
import { OWNED_WORKSPACE_LIMITS, effectiveOwnedPlan } from './quota.js'

describe('effectiveOwnedPlan', () => {
  test('empty input falls back to free (defensive floor)', () => {
    expect(effectiveOwnedPlan([])).toBe('free')
  })

  test('single plan returns that plan', () => {
    expect(effectiveOwnedPlan(['free'])).toBe('free')
    expect(effectiveOwnedPlan(['starter'])).toBe('starter')
    expect(effectiveOwnedPlan(['team'])).toBe('team')
    expect(effectiveOwnedPlan(['enterprise'])).toBe('enterprise')
  })

  test('picks highest tier when mixed — upgrading any one workspace lifts the cap', () => {
    expect(effectiveOwnedPlan(['free', 'starter'])).toBe('starter')
    expect(effectiveOwnedPlan(['free', 'team', 'free'])).toBe('team')
    expect(effectiveOwnedPlan(['starter', 'enterprise', 'team'])).toBe('enterprise')
  })

  test('order independent', () => {
    expect(effectiveOwnedPlan(['team', 'free'])).toBe('team')
    expect(effectiveOwnedPlan(['free', 'team'])).toBe('team')
  })
})

describe('OWNED_WORKSPACE_LIMITS', () => {
  test('free is the strictest cap', () => {
    expect(OWNED_WORKSPACE_LIMITS.free).toBe(1)
  })

  test('paid tiers progressively raise the cap', () => {
    expect(OWNED_WORKSPACE_LIMITS.starter).toBe(2)
    expect(OWNED_WORKSPACE_LIMITS.team).toBe(5)
  })

  test('enterprise is unlimited', () => {
    expect(OWNED_WORKSPACE_LIMITS.enterprise).toBeNull()
  })
})
