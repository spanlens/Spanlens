import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The feature-flags module reads env vars once at import time. Tests
 * use vi.resetModules() so each describe block sees a fresh snapshot.
 */
describe('feature-flags', () => {
  afterEach(() => {
    delete process.env['USE_EVENTS_FOR_REQUESTS']
    delete process.env['EVENTS_BACKFILL_COMPLETE']
    vi.resetModules()
  })

  it('defaults useEventsForRequests to false when both env vars are missing', async () => {
    vi.resetModules()
    const mod = await import('./feature-flags.js')
    expect(mod.useEventsForRequests).toBe(false)
  })

  it('stays disabled when only USE_EVENTS_FOR_REQUESTS=1 (backfill ack missing)', async () => {
    process.env['USE_EVENTS_FOR_REQUESTS'] = '1'
    vi.resetModules()
    const mod = await import('./feature-flags.js')
    expect(mod.useEventsForRequests).toBe(false)
  })

  it('stays disabled when only EVENTS_BACKFILL_COMPLETE=1 (rollout not asked for)', async () => {
    process.env['EVENTS_BACKFILL_COMPLETE'] = '1'
    vi.resetModules()
    const mod = await import('./feature-flags.js')
    expect(mod.useEventsForRequests).toBe(false)
  })

  it('enables useEventsForRequests only when BOTH env vars are the literal "1"', async () => {
    process.env['USE_EVENTS_FOR_REQUESTS'] = '1'
    process.env['EVENTS_BACKFILL_COMPLETE'] = '1'
    vi.resetModules()
    const mod = await import('./feature-flags.js')
    expect(mod.useEventsForRequests).toBe(true)
  })

  it('rejects truthy-looking strings other than "1" so dev / CI / prod stay consistent', async () => {
    for (const v of ['true', 'TRUE', 'yes', 'on', '2']) {
      process.env['USE_EVENTS_FOR_REQUESTS'] = v
      process.env['EVENTS_BACKFILL_COMPLETE'] = v
      vi.resetModules()
      const mod = await import('./feature-flags.js')
      expect(mod.useEventsForRequests, `expected ${v} to be rejected`).toBe(false)
    }
  })

  it('snapshotFlags surfaces every flag for /health/deep', async () => {
    process.env['USE_EVENTS_FOR_REQUESTS'] = '1'
    process.env['EVENTS_BACKFILL_COMPLETE'] = '1'
    vi.resetModules()
    const mod = await import('./feature-flags.js')
    expect(mod.snapshotFlags()).toEqual({
      USE_EVENTS_FOR_REQUESTS: true,
      EVENTS_BACKFILL_COMPLETE: true,
      useEventsForRequests: true,
    })
  })
})
