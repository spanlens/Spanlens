import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { LOG_RETENTION_DAYS, OWNED_WORKSPACE_LIMITS } from '../lib/quota.js'

// Source guard against plan-table drift between the server and the
// dashboard. apps/web/lib/billing-plans.ts keeps its own copy of a few
// per-plan limits so Settings can render them without an extra fetch, and
// the dependency rule forbids apps/web from importing apps/server. The copy
// drifted once already: Settings → General showed 7 / 30 / 90 days of log
// retention while requestsScope clipped reads at 14 / 90 / 365 (XVERIFY
// C18.2).
//
// This guard lives on the server side on purpose. CI runs the server test
// suite on every PR but does not run the web vitest suite, so a guard in
// apps/web would never fire on a PR that only edits quota.ts.
//
// The web file is read as text rather than imported, for the same
// dependency-direction reason. The parser accepts only plain
// `key: <number | null>` entries, so an unexpected shape fails loudly
// instead of parsing to an empty table that trivially "matches".

const here = dirname(fileURLToPath(import.meta.url))
const serverRoot = resolve(here, '..', '..') // apps/server
const repoRoot = resolve(serverRoot, '..', '..') // repository root
const WEB_BILLING_PLANS = resolve(repoRoot, 'apps/web/lib/billing-plans.ts')

type PlanTable = Record<string, number | null>

function parseWebPlanTable(source: string, exportName: string): PlanTable {
  const pattern = new RegExp(`export const ${exportName}\\b[^=]*=\\s*\\{([\\s\\S]*?)\\n\\}`)
  const body = pattern.exec(source)?.[1]
  if (body === undefined) {
    throw new Error(`${exportName} not found in apps/web/lib/billing-plans.ts`)
  }

  const entries = body
    .replace(/\/\/.*$/gm, '')
    .split(',')
    .map((raw) => raw.trim())
    .filter((raw) => raw.length > 0)
    .map((raw) => {
      const match = /^(\w+)\s*:\s*(null|[\d_]+)$/.exec(raw)
      if (!match) {
        throw new Error(`${exportName}: cannot parse entry "${raw}" in apps/web/lib/billing-plans.ts`)
      }
      const [, plan, value] = match
      return [plan!, value === 'null' ? null : Number(value!.replace(/_/g, ''))] as const
    })

  return Object.fromEntries(entries)
}

describe('apps/web billing-plans.ts mirrors server plan limits', () => {
  const source = readFileSync(WEB_BILLING_PLANS, 'utf8')

  test('PLAN_RETENTION_DAYS equals LOG_RETENTION_DAYS (what requestsScope enforces)', () => {
    expect(parseWebPlanTable(source, 'PLAN_RETENTION_DAYS')).toEqual(LOG_RETENTION_DAYS)
  })

  test('PLAN_WORKSPACE_LIMITS equals OWNED_WORKSPACE_LIMITS', () => {
    expect(parseWebPlanTable(source, 'PLAN_WORKSPACE_LIMITS')).toEqual(OWNED_WORKSPACE_LIMITS)
  })

  test('the parser rejects a table it cannot read instead of returning an empty match', () => {
    expect(() => parseWebPlanTable('export const X = {\n  free: 14 * 2,\n}', 'X')).toThrow(
      /cannot parse entry/,
    )
    expect(() => parseWebPlanTable('const nothing = 1', 'PLAN_RETENTION_DAYS')).toThrow(/not found/)
  })
})
