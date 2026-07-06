import { describe, it, expect } from 'vitest'
import { renderWeeklyDigestEmail } from '../lib/resend.js'

function baseParams() {
  return {
    orgName: 'Acme Inc',
    periodLabel: 'Jun 29 to Jul 5',
    requestCount: 12345,
    totalCostUsd: 42.5,
    costChangePct: 25 as number | null,
    errorCount: 12,
    errorRatePct: 0.097,
    topModels: [
      { provider: 'openai', model: 'gpt-4o', costUsd: 30.25, requestCount: 4000 },
      { provider: 'anthropic', model: 'claude-sonnet', costUsd: 12.25, requestCount: 8345 },
    ],
    anomalyCount: 3 as number | null,
    recommendation: {
      currentModel: 'gpt-4o',
      suggestedModel: 'gpt-4o-mini',
      estimatedMonthlySavingsUsd: 87.5,
    } as { currentModel: string; suggestedModel: string; estimatedMonthlySavingsUsd: number } | null,
    dashboardUrl: 'https://www.spanlens.io/dashboard',
  }
}

describe('renderWeeklyDigestEmail', () => {
  it('builds the "Your Spanlens week" subject from requests and cost', () => {
    const { subject } = renderWeeklyDigestEmail(baseParams())
    expect(subject).toBe('Your Spanlens week: 12,345 requests, $42.50')
  })

  it('rounds large dollar amounts in the subject', () => {
    const { subject } = renderWeeklyDigestEmail({ ...baseParams(), totalCostUsd: 1234.56 })
    expect(subject).toBe('Your Spanlens week: 12,345 requests, $1,235')
  })

  it('never contains an em dash or en dash (external-copy policy)', () => {
    const variants = [
      baseParams(),
      { ...baseParams(), costChangePct: null, anomalyCount: null, recommendation: null, topModels: [] },
      { ...baseParams(), costChangePct: -40, errorCount: 0, anomalyCount: 0 },
    ]
    for (const params of variants) {
      const { subject, html } = renderWeeklyDigestEmail(params)
      expect(subject).not.toMatch(/[—–]/)
      expect(html).not.toMatch(/[—–]/)
    }
  })

  it('describes the cost trend direction', () => {
    expect(renderWeeklyDigestEmail(baseParams()).html).toContain(
      'Spend is up 25% from the week before.',
    )
    expect(renderWeeklyDigestEmail({ ...baseParams(), costChangePct: -40 }).html).toContain(
      'Spend is down 40% from the week before.',
    )
    expect(renderWeeklyDigestEmail({ ...baseParams(), costChangePct: 2 }).html).toContain(
      'Spend is about the same as the week before.',
    )
    expect(renderWeeklyDigestEmail({ ...baseParams(), costChangePct: null }).html).toContain(
      'There is no prior week to compare against yet.',
    )
  })

  it('lists top models with per-model cost and request counts', () => {
    const { html } = renderWeeklyDigestEmail(baseParams())
    expect(html).toContain('gpt-4o')
    expect(html).toContain('claude-sonnet')
    expect(html).toContain('$30.25')
    expect(html).toContain('8,345')
  })

  it('omits the models table when there are no model rows', () => {
    const { html } = renderWeeklyDigestEmail({ ...baseParams(), topModels: [] })
    expect(html).not.toContain('Top models by cost')
  })

  it('shows the error line, or a clean sentence when there were no failures', () => {
    expect(renderWeeklyDigestEmail(baseParams()).html).toContain(
      '12 failed requests (0.1% error rate).',
    )
    expect(renderWeeklyDigestEmail({ ...baseParams(), errorCount: 0 }).html).toContain(
      'No failed requests this week.',
    )
  })

  it('mentions anomalies only when at least one was detected', () => {
    expect(renderWeeklyDigestEmail(baseParams()).html).toContain('3 anomalies were detected')
    expect(renderWeeklyDigestEmail({ ...baseParams(), anomalyCount: 1 }).html).toContain(
      '1 anomaly was detected',
    )
    expect(renderWeeklyDigestEmail({ ...baseParams(), anomalyCount: 0 }).html).not.toContain(
      'detected this week',
    )
    expect(renderWeeklyDigestEmail({ ...baseParams(), anomalyCount: null }).html).not.toContain(
      'detected this week',
    )
  })

  it('includes the savings tip only when a recommendation exists', () => {
    const withRec = renderWeeklyDigestEmail(baseParams()).html
    expect(withRec).toContain('Savings tip')
    expect(withRec).toContain('gpt-4o-mini')
    expect(withRec).toContain('$87.50 per month')

    const withoutRec = renderWeeklyDigestEmail({ ...baseParams(), recommendation: null }).html
    expect(withoutRec).not.toContain('Savings tip')
  })

  it('links to the dashboard and escapes the org name', () => {
    const { html } = renderWeeklyDigestEmail({
      ...baseParams(),
      orgName: '<script>alert(1)</script>',
    })
    expect(html).toContain('https://www.spanlens.io/dashboard')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })
})
