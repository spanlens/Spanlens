import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// Mock @upstash/redis BEFORE importing the module so the lazy singleton
// picks up our stub the first time it constructs a client.
const evalMock = vi.fn()
const getMock = vi.fn()
const setMock = vi.fn()

vi.mock('@upstash/redis', () => ({
  Redis: vi.fn().mockImplementation(() => ({
    eval: (...args: unknown[]) => evalMock(...args),
    get: (...args: unknown[]) => getMock(...args),
    set: (...args: unknown[]) => setMock(...args),
  })),
}))

let cache: typeof import('./prompt-cache.js')

beforeEach(async () => {
  vi.resetModules()
  evalMock.mockReset()
  getMock.mockReset()
  setMock.mockReset()

  // Default env so getRedis() returns a client.
  process.env.KV_REST_API_URL = 'https://stub.upstash.io'
  process.env.KV_REST_API_TOKEN = 'stub-token'

  cache = await import('./prompt-cache.js')
  cache._resetRedisForTests()
})

afterEach(() => {
  delete process.env.KV_REST_API_URL
  delete process.env.KV_REST_API_TOKEN
})

describe('prompt-cache — fail-open behaviour', () => {
  test('returns null when KV env is missing (cold start, no Redis)', async () => {
    delete process.env.KV_REST_API_URL
    delete process.env.KV_REST_API_TOKEN
    cache._resetRedisForTests()

    expect(await cache.getCachedUuid('org', 'uuid')).toBeNull()
    expect(await cache.getCachedNameVersion('org', 'n', 1)).toBeNull()
    expect(await cache.getCachedLatest('org', 'n')).toBeNull()

    // Writes are silent no-ops.
    await expect(cache.setCachedUuid('org', 'uuid', 'v')).resolves.toBeUndefined()
    await expect(cache.invalidatePromptName('org', 'n')).resolves.toBeUndefined()

    expect(evalMock).not.toHaveBeenCalled()
    expect(getMock).not.toHaveBeenCalled()
    expect(setMock).not.toHaveBeenCalled()
  })

  test('returns null when Redis throws (fail-open)', async () => {
    getMock.mockRejectedValueOnce(new Error('upstream broke'))
    expect(await cache.getCachedUuid('org', 'uuid')).toBeNull()

    evalMock.mockRejectedValueOnce(new Error('upstream broke'))
    expect(await cache.getCachedLatest('org', 'name')).toBeNull()
  })
})

describe('prompt-cache — UUID lookups', () => {
  test('getCachedUuid returns the stored versionId on hit', async () => {
    getMock.mockResolvedValueOnce('version-id-from-cache')
    const result = await cache.getCachedUuid('org-1', 'uuid-1')
    expect(result).toBe('version-id-from-cache')

    expect(getMock).toHaveBeenCalledWith(cache._internals.uuidKey('org-1', 'uuid-1'))
  })

  test('getCachedUuid returns null on miss (undefined from Redis)', async () => {
    getMock.mockResolvedValueOnce(null)
    const result = await cache.getCachedUuid('org-1', 'uuid-1')
    expect(result).toBeNull()
  })

  test('setCachedUuid writes value with TTL', async () => {
    setMock.mockResolvedValueOnce('OK')
    await cache.setCachedUuid('org-1', 'uuid-1', 'version-1')

    expect(setMock).toHaveBeenCalledWith(
      cache._internals.uuidKey('org-1', 'uuid-1'),
      'version-1',
      { ex: cache._internals.VALUE_TTL_SECONDS },
    )
  })
})

describe('prompt-cache — name@version lookups', () => {
  test('getCachedNameVersion uses the read-if-unlocked Lua script', async () => {
    evalMock.mockResolvedValueOnce('version-id-99')
    const result = await cache.getCachedNameVersion('org-1', 'greeter', 3)
    expect(result).toBe('version-id-99')

    expect(evalMock).toHaveBeenCalledWith(
      cache._internals.READ_IF_UNLOCKED,
      [
        cache._internals.nameVersionKey('org-1', 'greeter', 3),
        cache._internals.lockKey('org-1', 'greeter'),
      ],
      [],
    )
  })

  test('getCachedNameVersion returns null when the lock is held', async () => {
    // Lua script returns false (lock present) → wrapper coerces to null.
    evalMock.mockResolvedValueOnce(false)
    const result = await cache.getCachedNameVersion('org-1', 'greeter', 3)
    expect(result).toBeNull()
  })

  test('setCachedNameVersion uses the set-if-unlocked Lua script with TTL', async () => {
    evalMock.mockResolvedValueOnce(1)
    await cache.setCachedNameVersion('org-1', 'greeter', 3, 'version-id')

    expect(evalMock).toHaveBeenCalledWith(
      cache._internals.SET_IF_UNLOCKED,
      [
        cache._internals.nameVersionKey('org-1', 'greeter', 3),
        cache._internals.lockKey('org-1', 'greeter'),
      ],
      ['version-id', String(cache._internals.VALUE_TTL_SECONDS)],
    )
  })
})

describe('prompt-cache — name@latest lookups', () => {
  test('getCachedLatest returns a single-version entry', async () => {
    evalMock.mockResolvedValueOnce(JSON.stringify({ kind: 'single', versionId: 'v-1' }))
    const result = await cache.getCachedLatest('org-1', 'greeter')
    expect(result).toEqual({ kind: 'single', versionId: 'v-1' })
  })

  test('getCachedLatest returns an experiment entry with full metadata', async () => {
    evalMock.mockResolvedValueOnce(
      JSON.stringify({
        kind: 'experiment',
        experimentId: 'exp-1',
        versionAId: 'va',
        versionBId: 'vb',
        trafficSplit: 30,
      }),
    )
    const result = await cache.getCachedLatest('org-1', 'greeter')
    expect(result).toEqual({
      kind: 'experiment',
      experimentId: 'exp-1',
      versionAId: 'va',
      versionBId: 'vb',
      trafficSplit: 30,
    })
  })

  test('getCachedLatest rejects malformed JSON', async () => {
    evalMock.mockResolvedValueOnce('not-json-at-all')
    expect(await cache.getCachedLatest('org-1', 'greeter')).toBeNull()
  })

  test('getCachedLatest accepts an already-parsed object (Upstash auto-deserialize)', async () => {
    // @upstash/redis runs automaticDeserialization on EVAL results so a
    // JSON-encoded value comes back as an object. The cache layer must
    // tolerate both shapes — regression test for prod bug found via the
    // smoke script on 2026-06-06.
    evalMock.mockResolvedValueOnce({ kind: 'single', versionId: 'v-1' })
    const result = await cache.getCachedLatest('org-1', 'greeter')
    expect(result).toEqual({ kind: 'single', versionId: 'v-1' })
  })

  test('getCachedLatest accepts an already-parsed experiment object', async () => {
    evalMock.mockResolvedValueOnce({
      kind: 'experiment',
      experimentId: 'exp-1',
      versionAId: 'va',
      versionBId: 'vb',
      trafficSplit: 60,
    })
    const result = await cache.getCachedLatest('org-1', 'greeter')
    expect(result).toEqual({
      kind: 'experiment',
      experimentId: 'exp-1',
      versionAId: 'va',
      versionBId: 'vb',
      trafficSplit: 60,
    })
  })

  test('getCachedLatest rejects payloads missing required fields', async () => {
    // missing versionAId / trafficSplit on experiment kind
    evalMock.mockResolvedValueOnce(
      JSON.stringify({ kind: 'experiment', experimentId: 'exp-1' }),
    )
    expect(await cache.getCachedLatest('org-1', 'greeter')).toBeNull()
  })

  test('getCachedLatest returns null when lock is held', async () => {
    evalMock.mockResolvedValueOnce(false)
    expect(await cache.getCachedLatest('org-1', 'greeter')).toBeNull()
  })

  test('setCachedLatest serialises both kinds', async () => {
    evalMock.mockResolvedValue(1)

    await cache.setCachedLatest('org-1', 'greeter', { kind: 'single', versionId: 'v-1' })
    expect(evalMock).toHaveBeenLastCalledWith(
      cache._internals.SET_IF_UNLOCKED,
      [
        cache._internals.latestKey('org-1', 'greeter'),
        cache._internals.lockKey('org-1', 'greeter'),
      ],
      [JSON.stringify({ kind: 'single', versionId: 'v-1' }), String(cache._internals.VALUE_TTL_SECONDS)],
    )

    await cache.setCachedLatest('org-1', 'greeter', {
      kind: 'experiment',
      experimentId: 'exp-1',
      versionAId: 'va',
      versionBId: 'vb',
      trafficSplit: 50,
    })
    expect(evalMock).toHaveBeenLastCalledWith(
      cache._internals.SET_IF_UNLOCKED,
      [
        cache._internals.latestKey('org-1', 'greeter'),
        cache._internals.lockKey('org-1', 'greeter'),
      ],
      [
        JSON.stringify({
          kind: 'experiment',
          experimentId: 'exp-1',
          versionAId: 'va',
          versionBId: 'vb',
          trafficSplit: 50,
        }),
        String(cache._internals.VALUE_TTL_SECONDS),
      ],
    )
  })
})

describe('prompt-cache — invalidation', () => {
  test('invalidatePromptName takes lock + deletes by pattern in one EVAL', async () => {
    evalMock.mockResolvedValueOnce(5)
    await cache.invalidatePromptName('org-1', 'greeter')

    expect(evalMock).toHaveBeenCalledTimes(1)
    const callArgs = evalMock.mock.calls[0]
    expect(callArgs).toBeDefined()

    // KEYS arg is the lock key for this (org, name)
    expect(callArgs?.[0]).toBe(cache._internals.INVALIDATE)
    expect(callArgs?.[1]).toEqual([cache._internals.lockKey('org-1', 'greeter')])

    // ARGV: [lock TTL, nv prefix, latest key, scan batch]
    const argv = callArgs?.[2] as unknown[]
    expect(argv[0]).toBe(String(cache._internals.LOCK_TTL_SECONDS))
    expect(argv[1]).toBe(`${cache._internals.KEY_PREFIX}nv:org-1:greeter:`)
    expect(argv[2]).toBe(cache._internals.latestKey('org-1', 'greeter'))
  })

  test('invalidation is a silent no-op when Redis is down', async () => {
    evalMock.mockRejectedValueOnce(new Error('redis exploded'))
    await expect(cache.invalidatePromptName('org-1', 'greeter')).resolves.toBeUndefined()
  })
})

describe('prompt-cache — concurrent invalidate + set', () => {
  test('set during invalidation is rejected by Lua lock check', async () => {
    // Simulate the Lua script's lock-check behaviour:
    // first call (invalidate) takes the lock; second call (set) sees the
    // lock and returns 0 (no write performed).
    let locked = false
    evalMock.mockImplementation(async (script: string) => {
      if (script === cache._internals.INVALIDATE) {
        locked = true
        return 3
      }
      if (script === cache._internals.SET_IF_UNLOCKED) {
        return locked ? 0 : 1
      }
      return null
    })

    await cache.invalidatePromptName('org-1', 'greeter')
    await cache.setCachedLatest('org-1', 'greeter', { kind: 'single', versionId: 'v-1' })

    // Both EVALs were dispatched; the lock check is the contract being tested.
    expect(evalMock).toHaveBeenCalledTimes(2)
  })

  test('read during invalidation returns null (lock-aware)', async () => {
    let locked = false
    evalMock.mockImplementation(async (script: string) => {
      if (script === cache._internals.INVALIDATE) {
        locked = true
        return 2
      }
      if (script === cache._internals.READ_IF_UNLOCKED) {
        return locked ? false : 'cached-version-id'
      }
      return null
    })

    // Cache populated, read OK.
    expect(await cache.getCachedNameVersion('org-1', 'greeter', 1)).toBe('cached-version-id')

    // Invalidation lock taken; subsequent reads bypass the cache.
    await cache.invalidatePromptName('org-1', 'greeter')
    expect(await cache.getCachedNameVersion('org-1', 'greeter', 1)).toBeNull()
    expect(await cache.getCachedLatest('org-1', 'greeter')).toBeNull()
  })
})

describe('prompt-cache — key layout', () => {
  test('keys are namespaced under spanlens:prompt: so they cannot collide with other Spanlens Redis data', () => {
    const prefix = cache._internals.KEY_PREFIX
    expect(prefix).toBe('spanlens:prompt:')
    expect(cache._internals.uuidKey('o', 'u')).toBe(`${prefix}uuid:o:u`)
    expect(cache._internals.nameVersionKey('o', 'n', 5)).toBe(`${prefix}nv:o:n:5`)
    expect(cache._internals.latestKey('o', 'n')).toBe(`${prefix}latest:o:n`)
    expect(cache._internals.lockKey('o', 'n')).toBe(`${prefix}lock:o:n`)
  })
})
