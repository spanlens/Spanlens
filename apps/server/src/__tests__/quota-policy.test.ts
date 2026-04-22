import { describe, it, expect } from 'vitest'
import { evaluateQuotaPolicy, blockMessage } from '../lib/quota-policy.js'

describe('evaluateQuotaPolicy — Pattern C', () => {
  const base = {
    limit: 100_000,
    allowOverage: true,
    capMultiplier: 5,
  }

  describe('enterprise (unlimited)', () => {
    it('always passes regardless of usage', () => {
      expect(
        evaluateQuotaPolicy({
          used: 10_000_000,
          limit: null,
          plan: 'enterprise',
          allowOverage: false,
          capMultiplier: 1,
        }),
      ).toEqual({ action: 'pass', overageActive: false })
    })
  })

  describe('under the soft limit', () => {
    it('passes for any plan', () => {
      for (const plan of ['free', 'starter', 'team'] as const) {
        expect(
          evaluateQuotaPolicy({ ...base, used: 50_000, plan }),
        ).toEqual({ action: 'pass', overageActive: false })
      }
    })
  })

  describe('free plan over limit', () => {
    it('blocks with free_limit reason', () => {
      expect(
        evaluateQuotaPolicy({ ...base, used: 100_001, plan: 'free' }),
      ).toEqual({ action: 'block', reason: 'free_limit' })
    })

    it('blocks regardless of allow_overage (free never gets overage)', () => {
      expect(
        evaluateQuotaPolicy({
          ...base,
          used: 100_000,
          plan: 'free',
          allowOverage: true,
          capMultiplier: 100,
        }),
      ).toEqual({ action: 'block', reason: 'free_limit' })
    })
  })

  describe('paid plan, overage disabled', () => {
    it('blocks at soft limit like Pattern A', () => {
      expect(
        evaluateQuotaPolicy({
          ...base,
          used: 100_000,
          plan: 'starter',
          allowOverage: false,
        }),
      ).toEqual({ action: 'block', reason: 'overage_disabled' })
    })
  })

  describe('paid plan, overage enabled, inside the overage band', () => {
    it('passes with overageActive=true at limit', () => {
      expect(
        evaluateQuotaPolicy({ ...base, used: 100_000, plan: 'starter' }),
      ).toEqual({ action: 'pass', overageActive: true })
    })

    it('passes with overageActive=true in the middle of the band', () => {
      expect(
        evaluateQuotaPolicy({ ...base, used: 250_000, plan: 'starter' }),
      ).toEqual({ action: 'pass', overageActive: true })
    })

    it('passes with overageActive=true just below the hard cap', () => {
      // cap = 100K * 5 = 500K; 499,999 < cap → still in band
      expect(
        evaluateQuotaPolicy({ ...base, used: 499_999, plan: 'starter' }),
      ).toEqual({ action: 'pass', overageActive: true })
    })
  })

  describe('paid plan, overage enabled, hard cap reached', () => {
    it('blocks at exactly the hard cap', () => {
      // cap = 100K * 5 = 500K
      expect(
        evaluateQuotaPolicy({ ...base, used: 500_000, plan: 'starter' }),
      ).toEqual({ action: 'block', reason: 'hard_cap' })
    })

    it('blocks above the hard cap', () => {
      expect(
        evaluateQuotaPolicy({ ...base, used: 10_000_000, plan: 'team', capMultiplier: 3 }),
      ).toEqual({ action: 'block', reason: 'hard_cap' })
    })

    it('respects custom capMultiplier (1x = immediate block at limit)', () => {
      // cap=1 means hard_cap == limit; over limit is over cap
      expect(
        evaluateQuotaPolicy({
          ...base,
          used: 100_001,
          plan: 'starter',
          capMultiplier: 1,
        }),
      ).toEqual({ action: 'block', reason: 'hard_cap' })
    })
  })

  describe('overageActive flag semantics', () => {
    it('is false when under the soft limit (overage not kicked in yet)', () => {
      expect(
        evaluateQuotaPolicy({ ...base, used: 80_000, plan: 'starter' }),
      ).toEqual({ action: 'pass', overageActive: false })
    })

    it('flips to true exactly at limit', () => {
      const just_under = evaluateQuotaPolicy({ ...base, used: 99_999, plan: 'starter' })
      const at_limit = evaluateQuotaPolicy({ ...base, used: 100_000, plan: 'starter' })
      expect(just_under.action === 'pass' && just_under.overageActive).toBe(false)
      expect(at_limit.action === 'pass' && at_limit.overageActive).toBe(true)
    })
  })
})

describe('blockMessage', () => {
  it('has distinct, user-readable text per reason', () => {
    const free = blockMessage('free_limit')
    const disabled = blockMessage('overage_disabled')
    const cap = blockMessage('hard_cap')
    expect(free).toContain('Free')
    expect(disabled).toContain('overage')
    expect(cap).toContain('cap')
    // distinctness
    expect(new Set([free, disabled, cap]).size).toBe(3)
  })
})
