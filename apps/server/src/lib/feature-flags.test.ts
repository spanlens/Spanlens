import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The feature-flags module reads env vars once at import time. Tests
 * use vi.resetModules() so each describe block sees a fresh snapshot.
 *
 * R-12 Phase 3.2 split the read switch into three per-route env gates
 * (REQUESTS / STATS / TRACES), all double-gated on
 * EVENTS_BACKFILL_COMPLETE. The per-org DB flag composition lives in
 * events-read-flag.ts and is tested there.
 */

const EVENT_FLAG_VARS = [
  'USE_EVENTS_FOR_REQUESTS',
  'USE_EVENTS_FOR_STATS',
  'USE_EVENTS_FOR_TRACES',
  'EVENTS_BACKFILL_COMPLETE',
] as const

describe('feature-flags', () => {
  afterEach(() => {
    for (const v of EVENT_FLAG_VARS) delete process.env[v]
    vi.resetModules()
  })

  it('defaults every env gate to false when no env vars are set', async () => {
    vi.resetModules()
    const mod = await import('./feature-flags.js')
    expect(mod.envUseEventsForRequests).toBe(false)
    expect(mod.envUseEventsForStats).toBe(false)
    expect(mod.envUseEventsForTraces).toBe(false)
  })

  it('stays disabled when only the route var is set (backfill ack missing)', async () => {
    process.env['USE_EVENTS_FOR_REQUESTS'] = '1'
    process.env['USE_EVENTS_FOR_STATS'] = '1'
    process.env['USE_EVENTS_FOR_TRACES'] = '1'
    vi.resetModules()
    const mod = await import('./feature-flags.js')
    expect(mod.envUseEventsForRequests).toBe(false)
    expect(mod.envUseEventsForStats).toBe(false)
    expect(mod.envUseEventsForTraces).toBe(false)
  })

  it('stays disabled when only EVENTS_BACKFILL_COMPLETE=1 (rollout not asked for)', async () => {
    process.env['EVENTS_BACKFILL_COMPLETE'] = '1'
    vi.resetModules()
    const mod = await import('./feature-flags.js')
    expect(mod.envUseEventsForRequests).toBe(false)
    expect(mod.envUseEventsForStats).toBe(false)
    expect(mod.envUseEventsForTraces).toBe(false)
  })

  it('gates each route independently — requests on, stats/traces stay off', async () => {
    process.env['USE_EVENTS_FOR_REQUESTS'] = '1'
    process.env['EVENTS_BACKFILL_COMPLETE'] = '1'
    vi.resetModules()
    const mod = await import('./feature-flags.js')
    expect(mod.envUseEventsForRequests).toBe(true)
    expect(mod.envUseEventsForStats).toBe(false)
    expect(mod.envUseEventsForTraces).toBe(false)
  })

  it('enables stats and traces gates with their own vars + backfill ack', async () => {
    process.env['USE_EVENTS_FOR_STATS'] = '1'
    process.env['USE_EVENTS_FOR_TRACES'] = '1'
    process.env['EVENTS_BACKFILL_COMPLETE'] = '1'
    vi.resetModules()
    const mod = await import('./feature-flags.js')
    expect(mod.envUseEventsForRequests).toBe(false)
    expect(mod.envUseEventsForStats).toBe(true)
    expect(mod.envUseEventsForTraces).toBe(true)
  })

  it('rejects truthy-looking strings other than "1" so dev / CI / prod stay consistent', async () => {
    for (const v of ['true', 'TRUE', 'yes', 'on', '2']) {
      process.env['USE_EVENTS_FOR_REQUESTS'] = v
      process.env['EVENTS_BACKFILL_COMPLETE'] = v
      vi.resetModules()
      const mod = await import('./feature-flags.js')
      expect(mod.envUseEventsForRequests, `expected ${v} to be rejected`).toBe(false)
    }
  })

  it('snapshotFlags surfaces every flag for /health/deep', async () => {
    process.env['USE_EVENTS_FOR_REQUESTS'] = '1'
    process.env['EVENTS_BACKFILL_COMPLETE'] = '1'
    vi.resetModules()
    const mod = await import('./feature-flags.js')
    expect(mod.snapshotFlags()).toEqual({
      USE_EVENTS_FOR_REQUESTS: true,
      USE_EVENTS_FOR_STATS: false,
      USE_EVENTS_FOR_TRACES: false,
      EVENTS_BACKFILL_COMPLETE: true,
      envUseEventsForRequests: true,
      envUseEventsForStats: false,
      envUseEventsForTraces: false,
    })
  })
})
