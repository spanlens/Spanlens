import { describe, expect, it } from 'vitest'
import { retentionLabelFor } from './plan-retention'

/**
 * Settings → General used to hard-code its own retention table (free 7,
 * starter 30, team 90 days) while the server clipped reads at 14 / 90 / 365.
 * Every plan was under-reported, and the table drifted because nothing tied
 * it to the value the server enforces.
 *
 * The label now comes from PLAN_RETENTION_DAYS. The drift guard that compares
 * that table with the server's LOG_RETENTION_DAYS lives in
 * apps/server/src/__tests__/web-plan-mirror.test.ts, because CI runs the
 * server test suite on every PR and does not run this one.
 */

describe('retentionLabelFor', () => {
  it('reports what the server enforces for each plan', () => {
    expect(retentionLabelFor('free')).toBe('14 days')
    expect(retentionLabelFor('starter')).toBe('90 days')
    expect(retentionLabelFor('team')).toBe('365 days')
    expect(retentionLabelFor('enterprise')).toBe('365 days')
  })

  it('returns null for an unknown or missing plan instead of guessing', () => {
    // The old fallback printed "7 days" before the org had even loaded.
    expect(retentionLabelFor(undefined)).toBeNull()
    expect(retentionLabelFor(null)).toBeNull()
    expect(retentionLabelFor('platinum')).toBeNull()
  })
})
