import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * R-4/R-5: authApiKey cache tests.
 *
 * The middleware-level integration test for authApiKey already lives in
 * authApiKey.integration.test.ts (Supabase-backed). These tests are
 * narrow: they pin the cache semantics so a future refactor can't
 * silently weaken them.
 *
 *   - hit       Same key within TTL → no second DB call
 *   - miss      Expired entry → fresh DB call + re-populate
 *   - eviction  > MAX_ENTRIES → oldest dropped (FIFO)
 *   - invalidate  explicit invalidation drops the entry instantly
 *
 * The TTL choice (30s full / 60s public) is enforced via the public
 * `apiKeyScope` path — both branches share the same hot code, so one
 * assertion per scope is enough.
 */

const supabaseSingleMock = vi.fn()

vi.mock('../lib/db.js', () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            single: () => supabaseSingleMock(),
          }),
        }),
      }),
    }),
  },
}))

// crypto.sha256Hex is deterministic — return a fixed hash per raw key so
// the cache map sees a stable key under test.
vi.mock('../lib/crypto.js', () => ({
  sha256Hex: async (s: string) => `hash:${s}`,
  // randomHex isn't called by authApiKey but other transitive imports
  // touch it during module init.
  randomHex: (n: number) => 'r'.repeat(n),
  aes256Encrypt: async (s: string) => s,
  aes256Decrypt: async (s: string) => s,
}))

vi.mock('../lib/api-key-last-used.js', () => ({
  maybeStampLastUsed: vi.fn(async () => undefined),
}))

vi.mock('../lib/wait-until.js', () => ({
  fireAndForget: vi.fn(),
}))

let authApiKey: typeof import('../middleware/authApiKey.js').authApiKey
let _clearApiKeyCacheForTests: typeof import('../middleware/authApiKey.js')._clearApiKeyCacheForTests
let invalidateApiKeyCache: typeof import('../middleware/authApiKey.js').invalidateApiKeyCache

beforeEach(async () => {
  vi.resetModules()
  supabaseSingleMock.mockReset()
  ;({ authApiKey, _clearApiKeyCacheForTests, invalidateApiKeyCache } = await import(
    '../middleware/authApiKey.js'
  ))
})

afterEach(() => {
  _clearApiKeyCacheForTests()
})

/**
 * Build a minimal Hono context that runs authApiKey end-to-end without
 * a real router. We capture every c.set() call so the assertions can
 * confirm the right values landed on the context.
 */
function makeCtx(rawKey: string) {
  const vars: Record<string, unknown> = {}
  return {
    req: {
      header: (name: string) =>
        name.toLowerCase() === 'authorization' ? `Bearer ${rawKey}` : undefined,
    },
    set: (k: string, v: unknown) => {
      vars[k] = v
    },
    get: (k: string) => vars[k],
    json: (body: unknown, status?: number) => ({ status: status ?? 200, body }),
    executionCtx: undefined,
    vars,
  } as unknown as Parameters<typeof authApiKey>[0]
}

const mkRow = (overrides: Partial<{ scope: string; plan: string }> = {}) => ({
  data: {
    id: 'key-id-1',
    project_id: 'proj-1',
    organization_id: null,
    scope: overrides.scope ?? 'full',
    projects: {
      organization_id: 'org-1',
      organizations: { plan: overrides.plan ?? 'starter' },
    },
    organizations: null,
  },
  error: null,
})

describe('authApiKey cache', () => {
  test('hit: same key within TTL → no second Supabase call', async () => {
    supabaseSingleMock.mockResolvedValueOnce(mkRow())

    const c1 = makeCtx('sl_live_test')
    await authApiKey(c1, async () => undefined)
    expect(supabaseSingleMock).toHaveBeenCalledTimes(1)

    // second request — same key, immediately. Cache must serve it.
    const c2 = makeCtx('sl_live_test')
    await authApiKey(c2, async () => undefined)
    expect(supabaseSingleMock).toHaveBeenCalledTimes(1)

    // Context vars populated on both
    const v1 = (c1 as unknown as { vars: Record<string, unknown> }).vars
    const v2 = (c2 as unknown as { vars: Record<string, unknown> }).vars
    expect(v1.organizationId).toBe('org-1')
    expect(v1.plan).toBe('starter')
    expect(v2.organizationId).toBe('org-1')
    expect(v2.plan).toBe('starter')
  })

  test('miss: expired TTL → fresh Supabase call', async () => {
    supabaseSingleMock.mockResolvedValueOnce(mkRow({ plan: 'starter' }))

    const c1 = makeCtx('sl_live_expire')
    await authApiKey(c1, async () => undefined)
    expect(supabaseSingleMock).toHaveBeenCalledTimes(1)

    // Advance time past the 30s full-scope TTL.
    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + 31_000)

    supabaseSingleMock.mockResolvedValueOnce(mkRow({ plan: 'team' }))
    const c2 = makeCtx('sl_live_expire')
    await authApiKey(c2, async () => undefined)
    expect(supabaseSingleMock).toHaveBeenCalledTimes(2)

    // Fresh lookup must reflect the new plan
    const v2 = (c2 as unknown as { vars: Record<string, unknown> }).vars
    expect(v2.plan).toBe('team')

    vi.useRealTimers()
  })

  test('public scope: TTL is 60s, longer than the 30s full window', async () => {
    supabaseSingleMock.mockResolvedValueOnce({
      data: {
        id: 'pub-key',
        project_id: null,
        organization_id: 'org-pub',
        scope: 'public',
        projects: null,
        organizations: { plan: 'team' },
      },
      error: null,
    })

    const c1 = makeCtx('sl_live_pub_test')
    await authApiKey(c1, async () => undefined)
    expect(supabaseSingleMock).toHaveBeenCalledTimes(1)

    // Just past 30s — full would expire, public still valid
    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + 31_000)

    const c2 = makeCtx('sl_live_pub_test')
    await authApiKey(c2, async () => undefined)
    // Still a hit — public TTL is 60s
    expect(supabaseSingleMock).toHaveBeenCalledTimes(1)

    // Past 60s — now expired
    vi.setSystemTime(Date.now() + 30_000)
    supabaseSingleMock.mockResolvedValueOnce({
      data: {
        id: 'pub-key',
        project_id: null,
        organization_id: 'org-pub',
        scope: 'public',
        projects: null,
        organizations: { plan: 'team' },
      },
      error: null,
    })
    const c3 = makeCtx('sl_live_pub_test')
    await authApiKey(c3, async () => undefined)
    expect(supabaseSingleMock).toHaveBeenCalledTimes(2)

    vi.useRealTimers()
  })

  test('eviction: > MAX_ENTRIES drops the oldest (FIFO)', async () => {
    // Fill the cache to capacity + 1 with distinct keys. Then assert
    // that the very first key requires a fresh DB call on re-lookup.
    const MAX = 1000
    for (let i = 0; i <= MAX; i += 1) {
      supabaseSingleMock.mockResolvedValueOnce({
        data: {
          id: `key-${i}`,
          project_id: `proj-${i}`,
          organization_id: null,
          scope: 'full',
          projects: {
            organization_id: `org-${i}`,
            organizations: { plan: 'free' },
          },
          organizations: null,
        },
        error: null,
      })
      const c = makeCtx(`sl_live_key_${i}`)
      await authApiKey(c, async () => undefined)
    }
    expect(supabaseSingleMock).toHaveBeenCalledTimes(MAX + 1)

    // Original key (index 0) should have been evicted → fresh call
    supabaseSingleMock.mockResolvedValueOnce({
      data: {
        id: 'key-0',
        project_id: 'proj-0',
        organization_id: null,
        scope: 'full',
        projects: {
          organization_id: 'org-0',
          organizations: { plan: 'free' },
        },
        organizations: null,
      },
      error: null,
    })
    const cReload = makeCtx('sl_live_key_0')
    await authApiKey(cReload, async () => undefined)
    expect(supabaseSingleMock).toHaveBeenCalledTimes(MAX + 2)
  })

  test('invalidate: explicit invalidateApiKeyCache(keyHash) drops entry instantly', async () => {
    supabaseSingleMock.mockResolvedValueOnce(mkRow())

    const c1 = makeCtx('sl_live_invalidate')
    await authApiKey(c1, async () => undefined)
    expect(supabaseSingleMock).toHaveBeenCalledTimes(1)

    // The sha256Hex mock maps 'sl_live_invalidate' → 'hash:sl_live_invalidate'.
    invalidateApiKeyCache('hash:sl_live_invalidate')

    supabaseSingleMock.mockResolvedValueOnce(mkRow())
    const c2 = makeCtx('sl_live_invalidate')
    await authApiKey(c2, async () => undefined)
    expect(supabaseSingleMock).toHaveBeenCalledTimes(2)
  })
})
