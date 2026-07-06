import { describe, it, expect } from 'vitest'
import { decideQuotaWarning, currentMonthStartMs } from '../lib/quota-warnings-stats.js'
import { __testing } from '../lib/notifiers.js'

describe('decideQuotaWarning — threshold logic', () => {
  const MONTH_START = Date.UTC(2026, 3, 1) // 2026-04-01
  const BEFORE_MONTH = MONTH_START - 1000 // stale timestamp from last month
  const IN_MONTH = MONTH_START + 86_400_000 // some point inside this month

  it('below 80% → no send', () => {
    expect(decideQuotaWarning(0.5, MONTH_START, null, null)).toEqual({ send: false, threshold: null })
    expect(decideQuotaWarning(0.79, MONTH_START, null, null)).toEqual({ send: false, threshold: null })
  })

  it('at 80% exactly → send 80', () => {
    expect(decideQuotaWarning(0.8, MONTH_START, null, null)).toEqual({ send: true, threshold: 80 })
  })

  it('between 80-100% → send 80 first', () => {
    expect(decideQuotaWarning(0.85, MONTH_START, null, null)).toEqual({ send: true, threshold: 80 })
    expect(decideQuotaWarning(0.99, MONTH_START, null, null)).toEqual({ send: true, threshold: 80 })
  })

  it('at or over 100% → send 100', () => {
    expect(decideQuotaWarning(1.0, MONTH_START, null, null)).toEqual({ send: true, threshold: 100 })
    expect(decideQuotaWarning(1.3, MONTH_START, null, null)).toEqual({ send: true, threshold: 100 })
  })

  it('100% overrides 80 even when 80 was already sent', () => {
    // user got the 80 email earlier, now they crossed 100 — we still want to tell them
    expect(
      decideQuotaWarning(1.0, MONTH_START, IN_MONTH, null),
    ).toEqual({ send: true, threshold: 100 })
  })

  it('80 already sent THIS month → no re-send at 85%', () => {
    expect(
      decideQuotaWarning(0.85, MONTH_START, IN_MONTH, null),
    ).toEqual({ send: false, threshold: null })
  })

  it('100 already sent this month → no 80 email later after traffic dip', () => {
    // org goes 1.2 → 0.85 (they deleted logs or traffic slowed) — we already
    // told them they're over, don't spam them with a retroactive 80 notice
    expect(
      decideQuotaWarning(0.85, MONTH_START, null, IN_MONTH),
    ).toEqual({ send: false, threshold: null })
  })

  it('stale timestamp from last month → eligible to send again', () => {
    expect(
      decideQuotaWarning(0.82, MONTH_START, BEFORE_MONTH, null),
    ).toEqual({ send: true, threshold: 80 })
    expect(
      decideQuotaWarning(1.05, MONTH_START, BEFORE_MONTH, BEFORE_MONTH),
    ).toEqual({ send: true, threshold: 100 })
  })

  it('100 already sent this month → suppresses re-send on the same threshold', () => {
    expect(
      decideQuotaWarning(1.5, MONTH_START, null, IN_MONTH),
    ).toEqual({ send: false, threshold: null })
  })
})

describe('currentMonthStartMs', () => {
  it('returns UTC midnight on the first of the month', () => {
    const ms = currentMonthStartMs(new Date('2026-04-15T12:34:56.789Z'))
    expect(new Date(ms).toISOString()).toBe('2026-04-01T00:00:00.000Z')
  })

  it('handles year rollover', () => {
    const ms = currentMonthStartMs(new Date('2026-01-05T00:00:00Z'))
    expect(new Date(ms).toISOString()).toBe('2026-01-01T00:00:00.000Z')
  })
})

describe('quota warning email templates', () => {
  const baseNotification = {
    organizationName: 'Acme Inc',
    used: 9_500,
    limit: 10_000,
    plan: 'starter',
    billingUrl: 'https://www.spanlens.io/billing',
    overageActive: false,
    hardCap: 50_000,
  }

  it('80 subject conveys "used 80%"', () => {
    const subj = __testing.buildQuotaSubject({ ...baseNotification, threshold: 80 })
    expect(subj).toContain('80%')
    expect(subj).toContain('Acme Inc')
  })

  it('100 subject conveys "quota reached" when overage disabled', () => {
    const subj = __testing.buildQuotaSubject({
      ...baseNotification,
      threshold: 100,
      overageActive: false,
    })
    expect(subj).toContain('reached')
  })

  it('100 subject conveys "overage billing active" when overage enabled', () => {
    const subj = __testing.buildQuotaSubject({
      ...baseNotification,
      threshold: 100,
      overageActive: true,
    })
    expect(subj.toLowerCase()).toContain('overage billing active')
  })

  it('80 body mentions usage, limit, and billing URL', () => {
    const body = __testing.buildQuotaBody({ ...baseNotification, threshold: 80 })
    expect(body).toContain('9,500')
    expect(body).toContain('10,000')
    expect(body).toContain('spanlens.io/billing')
  })

  it('80 body tells user overage will absorb the overflow when enabled', () => {
    const body = __testing.buildQuotaBody({
      ...baseNotification,
      threshold: 80,
      overageActive: true,
    })
    expect(body.toLowerCase()).toContain('overage billing is enabled')
  })

  it('80 body warns about 429s when overage disabled', () => {
    const body = __testing.buildQuotaBody({
      ...baseNotification,
      threshold: 80,
      overageActive: false,
    })
    expect(body).toContain('429')
  })

  it('100 body warns about 429s when overage disabled', () => {
    const body = __testing.buildQuotaBody({
      ...baseNotification,
      threshold: 100,
      overageActive: false,
      used: 10_042,
    })
    expect(body).toContain('429')
    expect(body).toContain('10,042')
  })

  it('100 body mentions overage billing + hard cap when overage enabled', () => {
    const body = __testing.buildQuotaBody({
      ...baseNotification,
      threshold: 100,
      overageActive: true,
      used: 10_042,
      hardCap: 50_000,
    })
    expect(body.toLowerCase()).toContain('overage billing')
    expect(body).toContain('50,000')
    expect(body).not.toMatch(/will receive 429/i)
  })

  it('100 body carries an explicit upgrade CTA with the billing URL', () => {
    for (const overageActive of [false, true]) {
      const body = __testing.buildQuotaBody({
        ...baseNotification,
        threshold: 100,
        overageActive,
        used: 10_042,
      })
      expect(body).toContain('Upgrade your plan')
      expect(body).toContain('https://www.spanlens.io/billing')
    }
  })

  it('100 body (overage disabled) truthfully states requests are rejected and not logged', () => {
    const body = __testing.buildQuotaBody({
      ...baseNotification,
      threshold: 100,
      overageActive: false,
      used: 10_042,
    })
    expect(body.toLowerCase()).toContain('rejected with 429')
    expect(body.toLowerCase()).toContain('not logged')
  })

  it('80 body includes the softer "raise your limit anytime" line with the billing link', () => {
    for (const overageActive of [false, true]) {
      const body = __testing.buildQuotaBody({
        ...baseNotification,
        threshold: 80,
        overageActive,
      })
      expect(body).toContain('You can raise your limit anytime')
      expect(body).toContain('https://www.spanlens.io/billing')
    }
  })

  it('email copy contains no em dashes', () => {
    for (const threshold of [80, 100] as const) {
      for (const overageActive of [false, true]) {
        const n = { ...baseNotification, threshold, overageActive }
        expect(__testing.buildQuotaBody(n)).not.toContain('—')
        expect(__testing.buildQuotaHtml(n)).not.toContain('—')
      }
    }
  })
})

describe('quota warning HTML template', () => {
  const baseNotification = {
    organizationName: 'Acme <Inc>',
    used: 10_042,
    limit: 10_000,
    plan: 'starter',
    billingUrl: 'https://www.spanlens.io/billing',
    overageActive: false,
    hardCap: 50_000,
  }

  it('100 html renders a prominent upgrade button linking to /billing', () => {
    const html = __testing.buildQuotaHtml({ ...baseNotification, threshold: 100 })
    expect(html).toContain('href="https://www.spanlens.io/billing"')
    expect(html).toContain('Upgrade your plan')
  })

  it('100 html (overage disabled) states rejection behavior', () => {
    const html = __testing.buildQuotaHtml({ ...baseNotification, threshold: 100 })
    expect(html).toContain('rejected with 429')
    expect(html).toContain('not logged')
  })

  it('100 html (overage active) states overage billing and the hard cap', () => {
    const html = __testing.buildQuotaHtml({
      ...baseNotification,
      threshold: 100,
      overageActive: true,
    })
    expect(html.toLowerCase()).toContain('overage')
    expect(html).toContain('50,000')
    expect(html).toContain('href="https://www.spanlens.io/billing"')
  })

  it('80 html keeps the same billing link with softer copy', () => {
    const html = __testing.buildQuotaHtml({ ...baseNotification, threshold: 80 })
    expect(html).toContain('href="https://www.spanlens.io/billing"')
    expect(html).toContain('raise your limit anytime')
  })

  it('escapes the organization name', () => {
    const html = __testing.buildQuotaHtml({ ...baseNotification, threshold: 100 })
    expect(html).not.toContain('Acme <Inc>')
    expect(html).toContain('Acme &lt;Inc&gt;')
  })
})
