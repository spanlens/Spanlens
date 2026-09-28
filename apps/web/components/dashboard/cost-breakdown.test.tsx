// @vitest-environment jsdom
import { describe, expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CostBreakdownCard } from './cost-breakdown'

/**
 * GET /api/v1/stats/models reports a model whose requests have no price on
 * file as `totalCostUsd: null` (it used to coerce that to 0). The chart draws
 * bar lengths from cost, so an unpriced group has nothing to draw and must
 * drop out rather than crash the sort or render as a zero-length "$0" bar.
 */
describe('CostBreakdownCard with unpriced models', () => {
  test('an unpriced-only window shows the empty state', () => {
    render(
      <CostBreakdownCard
        models={[
          { provider: 'xai', model: 'grok-mystery', requests: 9, totalCostUsd: null, avgLatencyMs: 200, errorRate: 0 },
        ]}
      />,
    )
    expect(screen.getByText('No spend recorded in this window.')).toBeInTheDocument()
  })
})
