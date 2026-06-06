import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The feature-flags module reads env vars once at import time. Tests
 * use vi.resetModules() so each describe block sees a fresh snapshot.
 */
describe('feature-flags', () => {
  afterEach(() => {
    delete process.env['USE_EVENTS_FOR_REQUESTS']
    vi.resetModules()
  })

  it('defaults USE_EVENTS_FOR_REQUESTS to false when the env var is missing', async () => {
    delete process.env['USE_EVENTS_FOR_REQUESTS']
    vi.resetModules()
    const mod = await import('./feature-flags.js')
    expect(mod.useEventsForRequests).toBe(false)
  })

  it('enables USE_EVENTS_FOR_REQUESTS only when the env var is the literal "1"', async () => {
    process.env['USE_EVENTS_FOR_REQUESTS'] = '1'
    vi.resetModules()
    const mod = await import('./feature-flags.js')
    expect(mod.useEventsForRequests).toBe(true)
  })

  it('rejects truthy-looking strings other than "1" so dev / CI / prod stay consistent', async () => {
    for (const v of ['true', 'TRUE', 'yes', 'on', '2']) {
      process.env['USE_EVENTS_FOR_REQUESTS'] = v
      vi.resetModules()
      const mod = await import('./feature-flags.js')
      expect(mod.useEventsForRequests, `expected ${v} to be rejected`).toBe(false)
    }
  })

  it('snapshotFlags surfaces every flag for /health/deep', async () => {
    process.env['USE_EVENTS_FOR_REQUESTS'] = '1'
    vi.resetModules()
    const mod = await import('./feature-flags.js')
    expect(mod.snapshotFlags()).toEqual({ USE_EVENTS_FOR_REQUESTS: true })
  })
})
