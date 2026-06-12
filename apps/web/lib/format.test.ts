import { describe, expect, test } from 'vitest'
import { fmtCostKpi, fmtCostDense, fmtCostSummary } from './format.js'

/**
 * Pin the three cost-formatting modes. The same input renders differently
 * on purpose — collapsing two modes would change the dashboard visually.
 * If a regression flips the format silently, this file catches it.
 */

describe('fmtCostKpi — KPI / headline (always 2 digits, en-US separators)', () => {
  test('formats integer dollar amounts with thousand separator', () => {
    expect(fmtCostKpi(1234.5)).toBe('$1,234.50')
    expect(fmtCostKpi(1_000_000)).toBe('$1,000,000.00')
  })

  test('null and zero render as $0.00 (no layout reflow)', () => {
    expect(fmtCostKpi(null)).toBe('$0.00')
    expect(fmtCostKpi(undefined)).toBe('$0.00')
    expect(fmtCostKpi(0)).toBe('$0.00')
  })

  test('clips beyond 2 fraction digits (KPI tile is too small for trailing precision)', () => {
    expect(fmtCostKpi(0.00123)).toBe('$0.00')
    expect(fmtCostKpi(1.999)).toBe('$2.00')
  })
})

describe('fmtCostDense — per-row table cell (5 digits, "—" for missing)', () => {
  test('renders small amounts at 5 fraction digits with trailing zeros', () => {
    expect(fmtCostDense(0.00020)).toBe('$0.00020')
    expect(fmtCostDense(0.00200)).toBe('$0.00200')
  })

  test('null → "—"', () => {
    expect(fmtCostDense(null)).toBe('—')
    expect(fmtCostDense(undefined)).toBe('—')
  })

  test('zero and negative → "—" (empty rows do not pretend to have data)', () => {
    expect(fmtCostDense(0)).toBe('—')
    expect(fmtCostDense(-0.001)).toBe('—')
  })

  test('larger amounts keep all 5 digits (alignment)', () => {
    expect(fmtCostDense(12.5)).toBe('$12.50000')
  })
})

describe('fmtCostSummary — per-user/session aggregate ("< $0.01" cutoff)', () => {
  test('null → "—"', () => {
    expect(fmtCostSummary(null)).toBe('—')
    expect(fmtCostSummary(undefined)).toBe('—')
  })

  test('exactly zero → "$0.00" (distinguishes "no spend" from "missing data")', () => {
    expect(fmtCostSummary(0)).toBe('$0.00')
  })

  test('between 0 and 0.01 → "< $0.01" (cannot round-down to "$0.00" or operators get confused)', () => {
    expect(fmtCostSummary(0.0001)).toBe('< $0.01')
    expect(fmtCostSummary(0.009999)).toBe('< $0.01')
  })

  test('≥ 0.01 → "$N.NN" 2 fraction digits', () => {
    expect(fmtCostSummary(0.01)).toBe('$0.01')
    expect(fmtCostSummary(1.235)).toBe('$1.24') // banker's rounding via toFixed
    expect(fmtCostSummary(1234.56)).toBe('$1234.56')
  })
})
