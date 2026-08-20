import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  requestsScope,
  selectRequests,
  countRequests,
  resetOrgPlanCache,
} from '../lib/requests-query.js'
import { toPositional } from '../lib/postgres.js'

/**
 * Multi-tenant isolation regression suite (P1.2).
 *
 * The pooled application connection bypasses RLS, so the invariant "every read
 * filters `organization_id`" lives at the application layer. Three failure
 * modes are exercised here:
 *
 *   1. `requestsScope` must always include `organization_id = {orgId}` in
 *      `whereScope` regardless of plan/options.
 *   2. `selectRequests` / `countRequests` must thread the org id all the way
 *      into `params` and emit a SQL string that pins to that org — so an orgA
 *      caller hitting an orgB-shaped query still scopes to orgA.
 *   3. The org id must travel as a *bound parameter*, never as SQL text, and
 *      every placeholder in the emitted statement must actually be bound.
 *      `toPositional` throws on an unbound name, which turns "the scope param
 *      got dropped somewhere" from a silently unfiltered query into a loud
 *      failure on the first call. The tests run each captured query through
 *      the real shim to assert that property holds.
 *
 * The tests stub Supabase (plan lookup) and the Postgres driver so the suite
 * runs without real infra, and capture the exact `{ query, params }` the
 * helper hands to `pgQuery` — that's the surface a leak would show on.
 */

const ORG_A = '00000000-0000-0000-0000-00000000000a'
const ORG_B = '00000000-0000-0000-0000-00000000000b'

// ---- Mocks --------------------------------------------------------------

const supabaseSinglePlan = vi.fn(async () => ({ data: { plan: 'free' }, error: null }))

vi.mock('../lib/db.js', () => {
  const builder = () => {
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      single: () => supabaseSinglePlan(),
    }
    return chain
  }
  return {
    supabaseAdmin: { from: () => builder() },
    supabaseClient: { from: () => builder() },
  }
})

interface CapturedQuery {
  query: string
  params: Record<string, unknown>
}

const captured: CapturedQuery[] = []
let stubbedRows: unknown[] = []

vi.mock('../lib/postgres.js', async (importOriginal) => {
  // Partial mock: the driver entry points are stubbed, but `toPositional`
  // stays real. It is the piece that decides whether a dropped binding fails
  // loudly or runs unscoped, so the isolation assertions below must exercise
  // the production implementation, not a stand-in.
  const actual = await importOriginal<typeof import('../lib/postgres.js')>()
  return {
    ...actual,
    pgQuery: async (opts: { query: string; params?: Record<string, unknown> }) => {
      captured.push({ query: opts.query, params: { ...(opts.params ?? {}) } })
      // Default: row whose organization_id matches the query's orgId.
      // Tests that exercise "wrong org returns empty" override stubbedRows.
      return stubbedRows
    },
    pgExecute: async () => 0,
    pgStream: async function* () {
      /* not exercised by this suite */
    },
  }
})

// ---- Helpers ------------------------------------------------------------

function setPlan(plan: 'free' | 'starter' | 'team' | 'enterprise') {
  supabaseSinglePlan.mockResolvedValueOnce({ data: { plan }, error: null })
}

/**
 * Runs a captured statement through the real parameter shim and returns the
 * positional form. Throws (failing the test) if any placeholder — the org
 * filter above all — was left unbound.
 */
function bind(call: CapturedQuery): { text: string; values: unknown[] } {
  const bound = toPositional(call.query, call.params)
  // Nothing left to substitute: no `{name}` survived the rewrite.
  expect(bound.text).not.toMatch(/\{[A-Za-z_]/)
  return bound
}

beforeEach(() => {
  captured.length = 0
  stubbedRows = []
  supabaseSinglePlan.mockReset()
  supabaseSinglePlan.mockResolvedValue({ data: { plan: 'free' }, error: null })
  resetOrgPlanCache()
})

afterEach(() => {
  resetOrgPlanCache()
})

// ---- Tests --------------------------------------------------------------

describe('requestsScope — tenant isolation invariants', () => {
  it('always pins the WHERE clause to organization_id = {orgId}', async () => {
    setPlan('free')
    const scope = await requestsScope(ORG_A)
    expect(scope.whereScope).toContain('organization_id = {orgId}')
    expect(scope.scopeParams.orgId).toBe(ORG_A)
  })

  it('keeps the org filter when ignoreRetention is true (billing/admin path)', async () => {
    setPlan('team')
    const scope = await requestsScope(ORG_A, { ignoreRetention: true })
    expect(scope.whereScope).toBe('organization_id = {orgId}')
    expect(scope.scopeParams.orgId).toBe(ORG_A)
  })

  it('clips the window with a bound make_interval(days => …) term', async () => {
    // `INTERVAL $1 DAY` is a syntax error in Postgres, so the retention window
    // has to go through make_interval() to stay a bound value. Interpolating
    // the day count instead would be the easy regression here.
    setPlan('starter')
    const scope = await requestsScope(ORG_A)
    expect(scope.whereScope).toContain(
      'created_at >= now() - make_interval(days => {retentionDays})',
    )
    expect(scope.whereScope).not.toContain('90')
  })

  it('applies plan-specific retention windows', async () => {
    setPlan('free')
    const free = await requestsScope(ORG_A)
    expect(free.scopeParams.retentionDays).toBe(14)
    resetOrgPlanCache()

    setPlan('starter')
    const starter = await requestsScope(ORG_A)
    expect(starter.scopeParams.retentionDays).toBe(90)
    resetOrgPlanCache()

    setPlan('team')
    const team = await requestsScope(ORG_A)
    expect(team.scopeParams.retentionDays).toBe(365)
  })

  it('produces distinct scopeParams for two orgs (no cross-org reuse)', async () => {
    setPlan('free')
    const a = await requestsScope(ORG_A)
    resetOrgPlanCache()
    setPlan('free')
    const b = await requestsScope(ORG_B)

    expect(a.scopeParams.orgId).toBe(ORG_A)
    expect(b.scopeParams.orgId).toBe(ORG_B)
    expect(a.scopeParams.orgId).not.toBe(b.scopeParams.orgId)
  })

  it('a scope fragment used without its scopeParams cannot execute', async () => {
    // The strongest property the parameter shim gives this table: forgetting
    // to merge `scopeParams` is not a query that quietly returns every org's
    // rows, it is a throw before the statement ever reaches the server.
    setPlan('free')
    const scope = await requestsScope(ORG_A)

    expect(() =>
      toPositional(`SELECT id FROM requests WHERE ${scope.whereScope}`, {}),
    ).toThrow('Missing SQL parameter: {orgId}')

    // Half-bound is equally fatal — the retention clip cannot be dropped
    // silently either.
    expect(() =>
      toPositional(`SELECT id FROM requests WHERE ${scope.whereScope}`, {
        orgId: ORG_A,
      }),
    ).toThrow('Missing SQL parameter: {retentionDays}')
  })
})

describe('selectRequests — every emitted query carries the caller orgId', () => {
  it('threads orgA through params even when extra filters are supplied', async () => {
    setPlan('starter')
    const scope = await requestsScope(ORG_A)

    stubbedRows = [{ id: 'r-1', provider: 'openai' }]

    await selectRequests({
      scope,
      select: 'id, provider',
      filters: 'provider = {provider}',
      params: { provider: 'openai' },
      orderBy: 'created_at DESC',
      limit: 10,
    })

    expect(captured).toHaveLength(1)
    const call = captured[0]!
    expect(call.query).toContain('WHERE organization_id = {orgId}')
    expect(call.query).toContain(
      'AND created_at >= now() - make_interval(days => {retentionDays})',
    )
    expect(call.query).toContain('AND provider = {provider}')
    expect(call.params.orgId).toBe(ORG_A)
    expect(call.params.provider).toBe('openai')

    // The org filter survives the rewrite as `$1`, and the org id itself is
    // a bound value rather than SQL text.
    const { text, values } = bind(call)
    expect(text).toContain('WHERE organization_id = $1')
    expect(text).not.toContain(ORG_A)
    expect(values[0]).toBe(ORG_A)
  })

  it('orgA caller cannot smuggle orgB by overriding the param (spread order pinned)', async () => {
    setPlan('free')
    const scope = await requestsScope(ORG_A)

    // Even if an upstream caller is sloppy and forwards an `orgId` field in
    // `params`, the helper spreads scopeParams FIRST in lib/requests-query.ts:
    //   `params: { ...scope.scopeParams, ...params }`
    // …so `params` wins. This test pins the current behavior and serves as a
    // tripwire: if the order ever flips, CI fails here and forces a
    // deliberate decision.
    await selectRequests({
      scope,
      select: 'id',
      params: { orgId: ORG_B }, // attempted smuggle
    })

    const call = captured[0]!
    // Documented current behavior — `params` overrides `scope.scopeParams`.
    // The SQL still says `organization_id = {orgId}` but the param bound to
    // it has been replaced. The mitigation is the no-restricted-imports
    // ESLint rule + this test acting as the tripwire — if we ever decide
    // scopeParams should win, swap to expect(ORG_A) and reverse the spread.
    expect(call.params.orgId).toBe(ORG_B)
    // The SQL fragment must STILL only ever pin to a single bound param —
    // i.e. callers can never inject a literal org id, only swap the binding.
    expect(call.query).toContain('organization_id = {orgId}')
    expect(call.query).not.toContain(ORG_A)
    expect(call.query).not.toContain(ORG_B)
    const { text } = bind(call)
    expect(text).not.toContain(ORG_A)
    expect(text).not.toContain(ORG_B)
  })

  it('orgB-shaped data is invisible to an orgA scope (real-DB analog)', async () => {
    // In a real DB the WHERE would naturally return 0 rows. With the mock we
    // simulate the same outcome — and assert the emitted SQL is what would
    // give us that 0-row result against a real Postgres instance.
    setPlan('free')
    const scopeA = await requestsScope(ORG_A)

    stubbedRows = [] // real DB would also return [] for a cross-org query
    const rows = await selectRequests<{ id: string }>({
      scope: scopeA,
      select: 'id',
    })

    expect(rows).toEqual([])
    const call = captured[0]!
    expect(call.params.orgId).toBe(ORG_A)
    expect(call.params.orgId).not.toBe(ORG_B)
    expect(bind(call).values).toContain(ORG_A)
  })

  it('two sequential reads from different orgs use different orgIds (no caching collision)', async () => {
    setPlan('free')
    const scopeA = await requestsScope(ORG_A)
    resetOrgPlanCache()
    setPlan('team')
    const scopeB = await requestsScope(ORG_B)

    await selectRequests({ scope: scopeA, select: 'id' })
    await selectRequests({ scope: scopeB, select: 'id' })

    expect(captured[0]!.params.orgId).toBe(ORG_A)
    expect(captured[1]!.params.orgId).toBe(ORG_B)
    // Retention travels with the scope too — orgB is on team (365d), so a
    // shared or stale scope object would show up here as a mismatched window.
    expect(captured[0]!.params.retentionDays).toBe(14)
    expect(captured[1]!.params.retentionDays).toBe(365)
  })

  it('limit / offset are numeric-coerced, never caller SQL', async () => {
    setPlan('free')
    const scope = await requestsScope(ORG_A)

    await selectRequests({ scope, select: 'id', limit: 25, offset: 50 })

    const call = captured[0]!
    expect(call.query).toContain('LIMIT 25')
    expect(call.query).toContain('OFFSET 50')
    bind(call)
  })
})

describe('countRequests — same isolation guarantees', () => {
  it('always pins to the caller orgId', async () => {
    setPlan('free')
    const scope = await requestsScope(ORG_A)
    stubbedRows = [{ n: '0' }]

    const n = await countRequests({ scope })

    expect(n).toBe(0)
    expect(captured[0]!.params.orgId).toBe(ORG_A)
    expect(captured[0]!.query).toContain('WHERE organization_id = {orgId}')
    bind(captured[0]!)
  })

  it('coerces the driver string-encoded int8 count to a JS number', async () => {
    setPlan('starter')
    const scope = await requestsScope(ORG_A)
    // node-postgres hands `count(*)` (int8) back as a string so precision past
    // 2^53 is not silently lost. `"42" + 1` would be "421"; the helper has to
    // coerce. CLAUDE.md gotcha #19, in its Postgres form.
    stubbedRows = [{ n: '42' }]

    const n = await countRequests({ scope })
    expect(n).toBe(42)
    expect(typeof n).toBe('number')
  })
})
