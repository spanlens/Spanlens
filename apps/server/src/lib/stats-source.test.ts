import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * R-12 Phase 3.2 — statsSource() is now per-org: it delegates to
 * useEventsForStats(orgId) (env gate OR organizations.read_from_events).
 * The flag-resolution logic itself is covered in events-read-flag.test.ts;
 * here we only assert the table-name mapping.
 */

const { mockUseEventsForStats } = vi.hoisted(() => ({
  mockUseEventsForStats: vi.fn<(orgId: string) => Promise<boolean>>(),
}))

vi.mock('./events-read-flag.js', () => ({
  useEventsForStats: mockUseEventsForStats,
}))

import { statsSource } from './stats-source.js'

const ORG = '00000000-0000-4000-8000-000000000001'

describe('statsSource', () => {
  beforeEach(() => {
    mockUseEventsForStats.mockReset()
  })

  it('returns the legacy requests table when the org flag resolves false', async () => {
    mockUseEventsForStats.mockResolvedValue(false)
    await expect(statsSource(ORG)).resolves.toBe('requests')
    expect(mockUseEventsForStats).toHaveBeenCalledWith(ORG)
  })

  it('returns events_as_requests when the org flag resolves true', async () => {
    mockUseEventsForStats.mockResolvedValue(true)
    await expect(statsSource(ORG)).resolves.toBe('events_as_requests')
  })
})
