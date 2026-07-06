import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PLANS, PLAN_REQUEST_LIMITS, PLAN_RETENTION_DAYS, PLAN_SEAT_LIMITS } from './billing-plans'

/**
 * Drift guard for public/llms.txt and public/llms-full.txt.
 *
 * Both files are hand-written static assets served to AI crawlers, but they
 * restate pricing facts whose source of truth is lib/billing-plans.ts. If a
 * plan's price, quota, retention, seats, or overage rate changes there and
 * the llms files are not updated, AI answer engines keep citing stale prices
 * silently (2026-07-06 GEO audit finding). This test derives the expected
 * strings from the constants so any billing change fails CI until the llms
 * files are re-synced.
 *
 * If this test fails: update the "## Plans" section (and the FAQ in
 * llms-full.txt) to match lib/billing-plans.ts, then re-run.
 */

const PUBLIC_DIR = join(__dirname, '..', 'public')
const LLMS_FILES = ['llms.txt', 'llms-full.txt'] as const

function compactCount(n: number): string {
  if (n >= 1_000_000) return `${n / 1_000_000}M`
  if (n >= 1_000) return `${n / 1_000}K`
  return String(n)
}

/** "+$8 / 100K extra requests" (billing-plans feature) → "+$8 per extra 100K" (llms.txt phrasing) */
function overagePhrase(features: string[]): string | null {
  for (const f of features) {
    const m = f.match(/^\+\$(\d+) \/ 100K extra requests$/)
    if (m) return `+$${m[1]} per extra 100K`
  }
  return null
}

function expectedFactsFor(planId: string): string[] {
  const plan = PLANS.find((p) => p.id === planId)
  if (!plan) throw new Error(`plan ${planId} missing from PLANS`)
  const facts: string[] = []

  if (plan.priceUsd !== null && plan.priceUsd > 0) facts.push(`$${plan.priceUsd}/mo`)

  const requests = PLAN_REQUEST_LIMITS[planId]
  if (requests) facts.push(`${compactCount(requests)} requests/mo`)

  const retention = PLAN_RETENTION_DAYS[planId]
  if (retention) facts.push(`${retention}-day retention`)

  const seats = PLAN_SEAT_LIMITS[planId]
  if (seats) facts.push(`${seats} seat${seats === 1 ? '' : 's'}`)

  const overage = overagePhrase(plan.features)
  if (overage) facts.push(overage)

  return facts
}

describe.each(LLMS_FILES)('%s pricing facts match lib/billing-plans.ts', (file) => {
  const content = readFileSync(join(PUBLIC_DIR, file), 'utf8')

  it.each(['free', 'starter', 'team'])('plan "%s" facts are present', (planId) => {
    for (const fact of expectedFactsFor(planId)) {
      expect(content, `${file} is missing "${fact}" for plan "${planId}"`).toContain(fact)
    }
  })

  it('does not state a price for Enterprise (custom pricing)', () => {
    const enterprise = PLANS.find((p) => p.id === 'enterprise')
    expect(enterprise?.priceUsd).toBeNull()
    // Guard against someone hardcoding a fake Enterprise price into the file.
    expect(content).not.toMatch(/Enterprise: \$\d/)
  })
})
