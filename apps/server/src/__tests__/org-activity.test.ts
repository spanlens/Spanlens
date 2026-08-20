import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * org-activity tests.
 *
 * The watermark decides whether a cron is allowed to skip its scan of
 * `requests`, so the property that actually protects us is the direction of
 * every failure: an unreadable or missing watermark must produce "assume
 * active" and let the scan happen. Getting that backwards silently suppresses
 * customer alerts and usage rollups, which is far worse than the wasted work
 * this module exists to avoid. Most of the cases below pin that direction.
 *
 * The write path is also throttled, so the second property worth pinning is
 * that a burst of requests for one org does not turn into a burst of
 * Postgres writes, and that a failed write does not get throttled away.
 */

const upsertMock = vi.fn()
const selectResultMock = vi.fn()
let capturedUpsert: unknown = null
let capturedGte: [string, string] | null = null

vi.mock('../lib/db.js', () => ({
  supabaseAdmin: {
    from: (_table: string) => ({
      upsert: (payload: unknown, opts: unknown) => {
        capturedUpsert = { payload, opts }
        return upsertMock()
      },
      select: () => {
        const chain = {
          gte: (col: string, val: string) => {
            capturedGte = [col, val]
            return Object.assign(Promise.resolve(selectResultMock()), chain)
          },
          limit: () => selectResultMock(),
        }
        return chain
      },
    }),
  },
}))

let mod: typeof import('../lib/org-activity.js')

beforeEach(async () => {
  vi.resetModules()
  upsertMock.mockReset()
  selectResultMock.mockReset()
  capturedUpsert = null
  capturedGte = null
  mod = await import('../lib/org-activity.js')
  mod.resetOrgActivityThrottle()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('recordOrgActivity', () => {
  test('upserts the org with a fresh timestamp', async () => {
    upsertMock.mockResolvedValue({ error: null })
    await mod.recordOrgActivity('org-1')

    expect(upsertMock).toHaveBeenCalledTimes(1)
    const { payload, opts } = capturedUpsert as {
      payload: { organization_id: string; last_request_at: string }
      opts: { onConflict: string }
    }
    expect(payload.organization_id).toBe('org-1')
    expect(Date.now() - Date.parse(payload.last_request_at)).toBeLessThan(5_000)
    expect(opts.onConflict).toBe('organization_id')
  })

  test('throttles repeat writes for the same org', async () => {
    upsertMock.mockResolvedValue({ error: null })
    await mod.recordOrgActivity('org-1')
    await mod.recordOrgActivity('org-1')
    await mod.recordOrgActivity('org-1')
    expect(upsertMock).toHaveBeenCalledTimes(1)
  })

  test('does not throttle across different orgs', async () => {
    upsertMock.mockResolvedValue({ error: null })
    await mod.recordOrgActivity('org-1')
    await mod.recordOrgActivity('org-2')
    expect(upsertMock).toHaveBeenCalledTimes(2)
  })

  test('retries on the next call when the write failed', async () => {
    upsertMock.mockResolvedValueOnce({ error: { message: 'deadlock' } })
    upsertMock.mockResolvedValueOnce({ error: null })
    await mod.recordOrgActivity('org-1')
    await mod.recordOrgActivity('org-1')
    expect(upsertMock).toHaveBeenCalledTimes(2)
  })

  test('never throws when the write rejects', async () => {
    upsertMock.mockRejectedValue(new Error('connection reset'))
    await expect(mod.recordOrgActivity('org-1')).resolves.toBeUndefined()
  })

  test('ignores an empty organization id', async () => {
    await mod.recordOrgActivity('')
    expect(upsertMock).not.toHaveBeenCalled()
  })
})

describe('getOrgActivitySince', () => {
  test('maps orgs to their last-request timestamp', async () => {
    const ts = '2026-08-18T03:00:00.000Z'
    selectResultMock.mockReturnValue({
      data: [{ organization_id: 'org-1', last_request_at: ts }],
      error: null,
    })
    const map = await mod.getOrgActivitySince(new Date('2026-08-18T00:00:00.000Z'))
    expect(map?.get('org-1')).toBe(Date.parse(ts))
    expect(capturedGte).toEqual(['last_request_at', '2026-08-18T00:00:00.000Z'])
  })

  test('returns null when the lookup errors', async () => {
    selectResultMock.mockReturnValue({ data: null, error: { message: 'relation does not exist' } })
    await expect(mod.getOrgActivitySince(new Date())).resolves.toBeNull()
  })
})

describe('orgActiveSince', () => {
  const since = new Date('2026-08-18T00:00:00.000Z')

  test('assumes active when the watermark is unavailable', () => {
    expect(mod.orgActiveSince(null, 'org-1', since)).toBe(true)
  })

  test('is active when the last request is inside the window', () => {
    const map = new Map([['org-1', Date.parse('2026-08-18T01:00:00.000Z')]])
    expect(mod.orgActiveSince(map, 'org-1', since)).toBe(true)
  })

  test('is active on the window boundary', () => {
    const map = new Map([['org-1', since.getTime()]])
    expect(mod.orgActiveSince(map, 'org-1', since)).toBe(true)
  })

  test('is inactive when the last request predates the window', () => {
    const map = new Map([['org-1', Date.parse('2026-08-17T23:59:59.000Z')]])
    expect(mod.orgActiveSince(map, 'org-1', since)).toBe(false)
  })

  test('is inactive when the org has never been seen', () => {
    expect(mod.orgActiveSince(new Map(), 'org-1', since)).toBe(false)
  })
})

describe('anyActivitySince', () => {
  test('is true when at least one org is active', async () => {
    selectResultMock.mockReturnValue({ data: [{ organization_id: 'org-1' }], error: null })
    await expect(mod.anyActivitySince(new Date())).resolves.toBe(true)
  })

  test('is false when nothing is active', async () => {
    selectResultMock.mockReturnValue({ data: [], error: null })
    await expect(mod.anyActivitySince(new Date())).resolves.toBe(false)
  })

  test('fails open to true when the lookup errors', async () => {
    selectResultMock.mockReturnValue({ data: null, error: { message: 'timeout' } })
    await expect(mod.anyActivitySince(new Date())).resolves.toBe(true)
  })

  test('fails open to true when the lookup throws', async () => {
    selectResultMock.mockImplementation(() => {
      throw new Error('socket hang up')
    })
    await expect(mod.anyActivitySince(new Date())).resolves.toBe(true)
  })
})
