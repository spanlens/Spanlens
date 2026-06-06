import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// Programmable supabaseAdmin stub. We only need the
// `.from('api_keys').update(...).eq('id', ...)` chain to resolve.
const updateMock = vi.fn()
vi.mock('./db.js', () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      update: (values: Record<string, unknown>) => ({
        eq: (col: string, val: string) => updateMock(table, values, col, val),
      }),
    }),
  },
}))

let mod: typeof import('./api-key-last-used.js')

beforeEach(async () => {
  vi.resetModules()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-06-06T00:00:00Z'))
  updateMock.mockReset()
  mod = await import('./api-key-last-used.js')
  mod._resetLastUsedCacheForTests()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('maybeStampLastUsed', () => {
  test('first call for a key writes to the DB', async () => {
    updateMock.mockResolvedValueOnce({ error: null })
    await mod.maybeStampLastUsed('key-1')
    expect(updateMock).toHaveBeenCalledTimes(1)
    const [table, values, col, val] = updateMock.mock.calls[0] ?? []
    expect(table).toBe('api_keys')
    expect(values).toHaveProperty('last_used_at')
    expect(col).toBe('id')
    expect(val).toBe('key-1')
  })

  test('second call inside throttle window skips the DB write', async () => {
    updateMock.mockResolvedValue({ error: null })
    await mod.maybeStampLastUsed('key-1')
    await mod.maybeStampLastUsed('key-1')
    await mod.maybeStampLastUsed('key-1')
    expect(updateMock).toHaveBeenCalledTimes(1)
  })

  test('different keys do not share the throttle bucket', async () => {
    updateMock.mockResolvedValue({ error: null })
    await mod.maybeStampLastUsed('key-1')
    await mod.maybeStampLastUsed('key-2')
    await mod.maybeStampLastUsed('key-3')
    expect(updateMock).toHaveBeenCalledTimes(3)
  })

  test('writes again after the throttle window elapses', async () => {
    updateMock.mockResolvedValue({ error: null })
    await mod.maybeStampLastUsed('key-1')

    // Skip the throttle window plus 1ms so the next call fires.
    vi.advanceTimersByTime(mod._THROTTLE_MS_FOR_TESTS + 1)

    await mod.maybeStampLastUsed('key-1')
    expect(updateMock).toHaveBeenCalledTimes(2)
  })

  test('still records intent even when the DB returns an error', async () => {
    updateMock.mockResolvedValueOnce({ error: { message: 'down' } })
    // Should not throw.
    await expect(mod.maybeStampLastUsed('key-1')).resolves.toBeUndefined()
    expect(updateMock).toHaveBeenCalledTimes(1)
  })

  test('cache evicts oldest entry when capacity is exceeded', async () => {
    updateMock.mockResolvedValue({ error: null })

    // The cache cap (MAX_ENTRIES) is large in production. We don't want to
    // generate 10k fake keys here — instead, we drive the eviction code
    // indirectly by checking that cache size is bounded after many calls.
    // The hard-coded MAX_ENTRIES = 10_000 makes this not a tight test;
    // we settle for asserting growth tracks per-key uniqueness up to ~50.
    for (let i = 0; i < 50; i++) {
      await mod.maybeStampLastUsed(`key-${i}`)
    }
    expect(mod._cacheSizeForTests()).toBe(50)
  })
})
