import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * R-12 Phase 3.2 — per-org events read switch.
 *
 * The module composes module-load env gates (feature-flags.ts) with a
 * cached `organizations.read_from_events` lookup, so every test resets
 * the module registry, sets env, then dynamic-imports a fresh copy.
 */

interface DbResult {
  data: { read_from_events: boolean } | null
  error: { message: string } | null
}

const state = vi.hoisted(() => ({
  dbResult: { data: null, error: null } as DbResult,
  singleCalls: 0,
}))

vi.mock('./db.js', () => ({
  supabaseAdmin: {
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, _val: string) => ({
          single: async () => {
            state.singleCalls++
            return state.dbResult
          },
        }),
      }),
    }),
  },
}))

const ORG = '00000000-0000-4000-8000-000000000001'

const EVENT_FLAG_VARS = [
  'USE_EVENTS_FOR_REQUESTS',
  'USE_EVENTS_FOR_STATS',
  'USE_EVENTS_FOR_TRACES',
  'EVENTS_BACKFILL_COMPLETE',
] as const

async function freshModule() {
  vi.resetModules()
  return import('./events-read-flag.js')
}

describe('events-read-flag', () => {
  beforeEach(() => {
    state.dbResult = { data: null, error: null }
    state.singleCalls = 0
  })

  afterEach(() => {
    for (const v of EVENT_FLAG_VARS) delete process.env[v]
    vi.resetModules()
  })

  it('resolves false everywhere when env gates are off and the DB flag is false', async () => {
    state.dbResult = { data: { read_from_events: false }, error: null }
    const mod = await freshModule()
    await expect(mod.useEventsForRequests(ORG)).resolves.toBe(false)
    await expect(mod.useEventsForStats(ORG)).resolves.toBe(false)
    await expect(mod.useEventsForTraces(ORG)).resolves.toBe(false)
    // All three served by one cached lookup.
    expect(state.singleCalls).toBe(1)
  })

  it('flips ALL route families when the per-org DB flag is true (no env gates)', async () => {
    state.dbResult = { data: { read_from_events: true }, error: null }
    const mod = await freshModule()
    await expect(mod.useEventsForRequests(ORG)).resolves.toBe(true)
    await expect(mod.useEventsForStats(ORG)).resolves.toBe(true)
    await expect(mod.useEventsForTraces(ORG)).resolves.toBe(true)
  })

  it('route-differentiated env gate: requests on, stats/traces still consult the DB flag', async () => {
    process.env['USE_EVENTS_FOR_REQUESTS'] = '1'
    process.env['EVENTS_BACKFILL_COMPLETE'] = '1'
    state.dbResult = { data: { read_from_events: false }, error: null }
    const mod = await freshModule()
    await expect(mod.useEventsForRequests(ORG)).resolves.toBe(true)
    // Env gate short-circuits — the requests call never hits the DB.
    expect(state.singleCalls).toBe(0)
    await expect(mod.useEventsForStats(ORG)).resolves.toBe(false)
    await expect(mod.useEventsForTraces(ORG)).resolves.toBe(false)
    expect(state.singleCalls).toBe(1)
  })

  it('env gate without the backfill ack stays off (double-gate preserved)', async () => {
    process.env['USE_EVENTS_FOR_STATS'] = '1'
    state.dbResult = { data: { read_from_events: false }, error: null }
    const mod = await freshModule()
    await expect(mod.useEventsForStats(ORG)).resolves.toBe(false)
  })

  it('resolves false on lookup error (missing row / column not yet migrated)', async () => {
    state.dbResult = { data: null, error: { message: 'column organizations.read_from_events does not exist' } }
    const mod = await freshModule()
    await expect(mod.useEventsForRequests(ORG)).resolves.toBe(false)
  })

  it('caches the DB flag for subsequent calls (single Supabase round-trip)', async () => {
    state.dbResult = { data: { read_from_events: true }, error: null }
    const mod = await freshModule()
    await mod.orgReadsFromEvents(ORG)
    await mod.orgReadsFromEvents(ORG)
    await mod.orgReadsFromEvents(ORG)
    expect(state.singleCalls).toBe(1)
  })

  it('coalesces concurrent cold-cache callers onto one in-flight fetch', async () => {
    state.dbResult = { data: { read_from_events: true }, error: null }
    const mod = await freshModule()
    const results = await Promise.all([
      mod.orgReadsFromEvents(ORG),
      mod.orgReadsFromEvents(ORG),
      mod.orgReadsFromEvents(ORG),
    ])
    expect(results).toEqual([true, true, true])
    expect(state.singleCalls).toBe(1)
  })

  it('resetOrgReadsFromEventsCache() forces a fresh lookup', async () => {
    state.dbResult = { data: { read_from_events: false }, error: null }
    const mod = await freshModule()
    await expect(mod.orgReadsFromEvents(ORG)).resolves.toBe(false)
    // Operator flips the org on; cache reset makes it visible immediately.
    state.dbResult = { data: { read_from_events: true }, error: null }
    mod.resetOrgReadsFromEventsCache()
    await expect(mod.orgReadsFromEvents(ORG)).resolves.toBe(true)
    expect(state.singleCalls).toBe(2)
  })

  it('caches per organization, not globally', async () => {
    const ORG_B = '00000000-0000-4000-8000-000000000002'
    state.dbResult = { data: { read_from_events: true }, error: null }
    const mod = await freshModule()
    await expect(mod.orgReadsFromEvents(ORG)).resolves.toBe(true)
    state.dbResult = { data: { read_from_events: false }, error: null }
    await expect(mod.orgReadsFromEvents(ORG_B)).resolves.toBe(false)
    // ORG's cached true is untouched by ORG_B's lookup.
    await expect(mod.orgReadsFromEvents(ORG)).resolves.toBe(true)
    expect(state.singleCalls).toBe(2)
  })
})
