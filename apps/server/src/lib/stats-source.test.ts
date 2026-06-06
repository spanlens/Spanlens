import { afterEach, describe, expect, it, vi } from 'vitest'

describe('statsSource', () => {
  afterEach(() => {
    delete process.env['USE_EVENTS_FOR_REQUESTS']
    delete process.env['EVENTS_BACKFILL_COMPLETE']
    vi.resetModules()
  })

  it('defaults to the legacy requests table when no flag is set', async () => {
    vi.resetModules()
    const mod = await import('./stats-source.js')
    expect(mod.statsSource()).toBe('requests')
  })

  it('switches to events_as_requests when both flags are 1', async () => {
    process.env['USE_EVENTS_FOR_REQUESTS'] = '1'
    process.env['EVENTS_BACKFILL_COMPLETE'] = '1'
    vi.resetModules()
    const mod = await import('./stats-source.js')
    expect(mod.statsSource()).toBe('events_as_requests')
  })

  it('stays on requests when only the dashboard flag is set (backfill ack missing)', async () => {
    process.env['USE_EVENTS_FOR_REQUESTS'] = '1'
    vi.resetModules()
    const mod = await import('./stats-source.js')
    expect(mod.statsSource()).toBe('requests')
  })
})
