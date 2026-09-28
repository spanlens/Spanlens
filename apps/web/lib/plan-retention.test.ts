import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PLAN_RETENTION_DAYS } from './billing-plans'
import { retentionLabelFor } from './plan-retention'

/**
 * Settings → General used to hard-code its own retention table (free 7,
 * starter 30, team 90 days) while the server clipped reads at 14 / 90 / 365.
 * Every plan was under-reported, and the table drifted because nothing tied
 * it to the value the server enforces.
 *
 * The label now comes from PLAN_RETENTION_DAYS, and the drift guard below
 * reads the server's LOG_RETENTION_DAYS so the two cannot disagree again
 * without CI failing. (It reads the source as text: apps/web must not import
 * from apps/server.)
 */

const QUOTA_TS = join(__dirname, '..', '..', 'server', 'src', 'lib', 'quota.ts')

function serverRetentionDays(): Record<string, number> {
  const source = readFileSync(QUOTA_TS, 'utf8')
  const block = source.match(/export const LOG_RETENTION_DAYS[^=]*=\s*\{([\s\S]*?)\n\}/)
  if (!block?.[1]) throw new Error('LOG_RETENTION_DAYS not found in apps/server/src/lib/quota.ts')
  const withoutComments = block[1].replace(/\/\/.*$/gm, '')
  const entries = [...withoutComments.matchAll(/(\w+)\s*:\s*([\d_]+)/g)].map(
    ([, plan, days]) => [plan, Number(days!.replace(/_/g, ''))] as const,
  )
  return Object.fromEntries(entries)
}

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

describe('retention drift guard', () => {
  it('PLAN_RETENTION_DAYS matches the server LOG_RETENTION_DAYS exactly', () => {
    expect(PLAN_RETENTION_DAYS).toEqual(serverRetentionDays())
  })
})
