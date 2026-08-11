import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * P3.2: provider-key row cache tests.
 *
 * getDecryptedProviderKey() was the last uncached Supabase round-trip on
 * the proxy hot path. These tests pin the two properties that make the
 * cache acceptable, so a future refactor cannot silently weaken either:
 *
 *   - **Latency**: a repeat call inside the TTL issues no second query,
 *     concurrent callers coalesce onto one query, and the entry does
 *     expire.
 *   - **Security**: only the ciphertext is cached. aes256Decrypt runs on
 *     EVERY call — a cache hit that skipped decryption would mean a
 *     decrypted provider credential was being held in process memory,
 *     which CLAUDE.md "보안 규칙" rule 3 forbids.
 *
 * Plus the invalidation contract, since a rotated or deleted key that
 * keeps working for 30s is the incident this whole design is guarding
 * against.
 */

const maybeSingleMock = vi.fn()

vi.mock('../lib/db.js', () => ({
  supabaseAdmin: {
    // provider_keys lookup chain: .select().eq().eq().eq().maybeSingle()
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () => maybeSingleMock(),
            }),
          }),
        }),
      }),
    }),
  },
  supabaseClient: {},
}))

// Counting stand-in for the real AES helper. The call count IS the
// assertion for "plaintext is not cached".
const aes256DecryptMock = vi.fn(async (ciphertext: string) => `plain:${ciphertext}`)

vi.mock('../lib/crypto.js', () => ({
  aes256Decrypt: (ciphertext: string) => aes256DecryptMock(ciphertext),
  aes256Encrypt: async (s: string) => s,
  sha256Hex: async (s: string) => `hash:${s}`,
  randomHex: (n: number) => 'r'.repeat(n),
}))

let getDecryptedProviderKey: typeof import('../proxy/utils.js').getDecryptedProviderKey
let invalidateProviderKeyCache: typeof import('../lib/provider-key-cache.js').invalidateProviderKeyCache
let invalidateProviderKeyCacheByRowId: typeof import('../lib/provider-key-cache.js').invalidateProviderKeyCacheByRowId
let _clearProviderKeyCacheForTests: typeof import('../lib/provider-key-cache.js')._clearProviderKeyCacheForTests

beforeEach(async () => {
  vi.resetModules()
  maybeSingleMock.mockReset()
  aes256DecryptMock.mockClear()
  ;({ getDecryptedProviderKey } = await import('../proxy/utils.js'))
  ;({
    invalidateProviderKeyCache,
    invalidateProviderKeyCacheByRowId,
    _clearProviderKeyCacheForTests,
  } = await import('../lib/provider-key-cache.js'))
})

afterEach(() => {
  _clearProviderKeyCacheForTests()
  vi.useRealTimers()
})

/** One `provider_keys` row as PostgREST returns it. */
const mkRow = (
  overrides: Partial<{
    id: string
    ciphertext: string
    metadata: Record<string, unknown>
  }> = {},
) => ({
  data: {
    id: overrides.id ?? 'pk-1',
    encrypted_key: overrides.ciphertext ?? 'ct-1',
    provider_metadata: overrides.metadata ?? null,
  },
  error: null,
})

describe('provider-key cache — latency', () => {
  test('hit: same (apiKeyId, provider) within TTL → no second Supabase query', async () => {
    maybeSingleMock.mockResolvedValueOnce(
      mkRow({ metadata: { resource_url: 'https://x.openai.azure.com' } }),
    )

    const first = await getDecryptedProviderKey('ak-1', 'openai')
    expect(maybeSingleMock).toHaveBeenCalledTimes(1)

    const second = await getDecryptedProviderKey('ak-1', 'openai')
    expect(maybeSingleMock).toHaveBeenCalledTimes(1)

    // The cached row must round-trip identically, metadata included.
    expect(second).toEqual(first)
    expect(second).toEqual({
      plaintext: 'plain:ct-1',
      id: 'pk-1',
      metadata: { resource_url: 'https://x.openai.azure.com' },
    })
  })

  test('same Spanlens key, different provider → separate cache entries', async () => {
    maybeSingleMock
      .mockResolvedValueOnce(mkRow({ id: 'pk-openai', ciphertext: 'ct-openai' }))
      .mockResolvedValueOnce(mkRow({ id: 'pk-anthropic', ciphertext: 'ct-anthropic' }))

    const openai = await getDecryptedProviderKey('ak-1', 'openai')
    const anthropic = await getDecryptedProviderKey('ak-1', 'anthropic')

    expect(maybeSingleMock).toHaveBeenCalledTimes(2)
    expect(openai?.id).toBe('pk-openai')
    expect(anthropic?.id).toBe('pk-anthropic')
  })

  test('expiry: past the 30s TTL → fresh Supabase query', async () => {
    maybeSingleMock.mockResolvedValueOnce(mkRow({ ciphertext: 'ct-old' }))
    expect(await getDecryptedProviderKey('ak-expire', 'openai')).toEqual({
      plaintext: 'plain:ct-old',
      id: 'pk-1',
      metadata: {},
    })
    expect(maybeSingleMock).toHaveBeenCalledTimes(1)

    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + 31_000)

    maybeSingleMock.mockResolvedValueOnce(mkRow({ ciphertext: 'ct-new' }))
    const afterExpiry = await getDecryptedProviderKey('ak-expire', 'openai')

    expect(maybeSingleMock).toHaveBeenCalledTimes(2)
    // Re-read, not the stale ciphertext.
    expect(afterExpiry?.plaintext).toBe('plain:ct-new')
  })

  test('coalescing: concurrent callers share one Supabase round-trip', async () => {
    let resolveFetch: (value: unknown) => void = () => {}
    const blocker = new Promise((resolve) => {
      resolveFetch = resolve
    })
    maybeSingleMock.mockReturnValueOnce(blocker)

    const p1 = getDecryptedProviderKey('ak-burst', 'openai')
    const p2 = getDecryptedProviderKey('ak-burst', 'openai')
    const p3 = getDecryptedProviderKey('ak-burst', 'openai')

    // All three joined the same in-flight query.
    expect(maybeSingleMock).toHaveBeenCalledTimes(1)

    resolveFetch(mkRow())
    const results = await Promise.all([p1, p2, p3])

    expect(maybeSingleMock).toHaveBeenCalledTimes(1)
    for (const r of results) expect(r?.plaintext).toBe('plain:ct-1')
    // Coalescing the QUERY must not coalesce the DECRYPT — each caller
    // decrypts for itself.
    expect(aes256DecryptMock).toHaveBeenCalledTimes(3)
  })
})

describe('provider-key cache — plaintext is never cached', () => {
  test('aes256Decrypt runs on every call, including cache hits', async () => {
    maybeSingleMock.mockResolvedValueOnce(mkRow({ ciphertext: 'ct-secret' }))

    await getDecryptedProviderKey('ak-1', 'openai')
    await getDecryptedProviderKey('ak-1', 'openai')
    await getDecryptedProviderKey('ak-1', 'openai')

    expect(maybeSingleMock).toHaveBeenCalledTimes(1)
    expect(aes256DecryptMock).toHaveBeenCalledTimes(3)
    // And it is the ciphertext being handed to the decrypt helper, never a
    // remembered plaintext.
    for (const call of aes256DecryptMock.mock.calls) {
      expect(call[0]).toBe('ct-secret')
    }
  })

  test('a cache hit whose decryption fails still returns null (Gotcha #5)', async () => {
    maybeSingleMock.mockResolvedValueOnce(mkRow({ ciphertext: 'ct-secret' }))
    expect(await getDecryptedProviderKey('ak-1', 'openai')).not.toBeNull()

    // Second call is served from cache, but ENCRYPTION_KEY has "changed":
    // an empty decrypt result must still short-circuit to null rather than
    // being papered over by a remembered plaintext.
    aes256DecryptMock.mockResolvedValueOnce('')
    expect(await getDecryptedProviderKey('ak-1', 'openai')).toBeNull()
    expect(maybeSingleMock).toHaveBeenCalledTimes(1)
  })
})

describe('provider-key cache — negative entries', () => {
  test('a miss is cached, so a misconfigured caller cannot hammer Supabase', async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: null })

    expect(await getDecryptedProviderKey('ak-none', 'openai')).toBeNull()
    expect(await getDecryptedProviderKey('ak-none', 'openai')).toBeNull()
    expect(await getDecryptedProviderKey('ak-none', 'openai')).toBeNull()

    expect(maybeSingleMock).toHaveBeenCalledTimes(1)
    // Nothing to decrypt on a miss.
    expect(aes256DecryptMock).not.toHaveBeenCalled()
  })

  test('the negative TTL (5s) is shorter than the positive TTL (30s)', async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: null })
    expect(await getDecryptedProviderKey('ak-none', 'openai')).toBeNull()
    expect(maybeSingleMock).toHaveBeenCalledTimes(1)

    vi.useFakeTimers()
    // 4s in: still a cached miss.
    vi.setSystemTime(Date.now() + 4_000)
    expect(await getDecryptedProviderKey('ak-none', 'openai')).toBeNull()
    expect(maybeSingleMock).toHaveBeenCalledTimes(1)

    // 6s in: expired well before the 30s positive window — the customer
    // who just registered their first key gets served quickly even on an
    // instance that never saw the invalidation.
    vi.setSystemTime(Date.now() + 2_000)
    maybeSingleMock.mockResolvedValueOnce(mkRow())
    expect(await getDecryptedProviderKey('ak-none', 'openai')).not.toBeNull()
    expect(maybeSingleMock).toHaveBeenCalledTimes(2)
  })
})

describe('provider-key cache — invalidation', () => {
  test('invalidateProviderKeyCache(apiKeyId, provider) drops the entry instantly', async () => {
    maybeSingleMock.mockResolvedValueOnce(mkRow({ ciphertext: 'ct-old' }))
    await getDecryptedProviderKey('ak-rotate', 'openai')
    expect(maybeSingleMock).toHaveBeenCalledTimes(1)

    invalidateProviderKeyCache('ak-rotate', 'openai')

    maybeSingleMock.mockResolvedValueOnce(mkRow({ ciphertext: 'ct-rotated' }))
    const after = await getDecryptedProviderKey('ak-rotate', 'openai')

    expect(maybeSingleMock).toHaveBeenCalledTimes(2)
    expect(after?.plaintext).toBe('plain:ct-rotated')
  })

  test('invalidation also clears a cached miss (the key-registration path)', async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: null })
    expect(await getDecryptedProviderKey('ak-new', 'openai')).toBeNull()

    // POST /api/v1/provider-keys registers the key and invalidates.
    invalidateProviderKeyCache('ak-new', 'openai')

    maybeSingleMock.mockResolvedValueOnce(mkRow())
    expect(await getDecryptedProviderKey('ak-new', 'openai')).not.toBeNull()
    expect(maybeSingleMock).toHaveBeenCalledTimes(2)
  })

  test('omitting the provider clears every entry under one Spanlens key', async () => {
    maybeSingleMock
      .mockResolvedValueOnce(mkRow({ id: 'pk-a' }))
      .mockResolvedValueOnce(mkRow({ id: 'pk-b' }))
    await getDecryptedProviderKey('ak-cascade', 'openai')
    await getDecryptedProviderKey('ak-cascade', 'anthropic')
    expect(maybeSingleMock).toHaveBeenCalledTimes(2)

    // DELETE /api/v1/api-keys/:id — provider_keys go with it via CASCADE
    // and the caller has no list of which providers existed.
    invalidateProviderKeyCache('ak-cascade')

    maybeSingleMock
      .mockResolvedValueOnce(mkRow({ id: 'pk-a' }))
      .mockResolvedValueOnce(mkRow({ id: 'pk-b' }))
    await getDecryptedProviderKey('ak-cascade', 'openai')
    await getDecryptedProviderKey('ak-cascade', 'anthropic')
    expect(maybeSingleMock).toHaveBeenCalledTimes(4)
  })

  test('prefix invalidation does not touch a different Spanlens key', async () => {
    maybeSingleMock
      .mockResolvedValueOnce(mkRow({ id: 'pk-mine' }))
      .mockResolvedValueOnce(mkRow({ id: 'pk-theirs' }))
    await getDecryptedProviderKey('ak-1', 'openai')
    await getDecryptedProviderKey('ak-2', 'openai')
    expect(maybeSingleMock).toHaveBeenCalledTimes(2)

    invalidateProviderKeyCache('ak-1')

    // ak-2 is still cached → no third query.
    await getDecryptedProviderKey('ak-2', 'openai')
    expect(maybeSingleMock).toHaveBeenCalledTimes(2)
  })

  test('invalidateProviderKeyCacheByRowId drops the entry holding that row', async () => {
    maybeSingleMock.mockResolvedValueOnce(mkRow({ id: 'pk-doomed' }))
    await getDecryptedProviderKey('ak-soft-delete', 'openai')
    expect(maybeSingleMock).toHaveBeenCalledTimes(1)

    // The soft-delete drain path only knows the provider_keys row UUID.
    invalidateProviderKeyCacheByRowId('pk-doomed')

    maybeSingleMock.mockResolvedValueOnce({ data: null, error: null })
    expect(await getDecryptedProviderKey('ak-soft-delete', 'openai')).toBeNull()
    expect(maybeSingleMock).toHaveBeenCalledTimes(2)
  })

  test('an invalidation during an in-flight query is not overwritten by it', async () => {
    let resolveFetch: (value: unknown) => void = () => {}
    const blocker = new Promise((resolve) => {
      resolveFetch = resolve
    })
    maybeSingleMock.mockReturnValueOnce(blocker)

    const inFlight = getDecryptedProviderKey('ak-race', 'openai')

    // Rotation lands while the SELECT is still open. The stale row must not
    // be written back into the cache with a fresh 30s lease.
    invalidateProviderKeyCache('ak-race', 'openai')

    resolveFetch(mkRow({ ciphertext: 'ct-stale' }))
    await inFlight

    maybeSingleMock.mockResolvedValueOnce(mkRow({ ciphertext: 'ct-fresh' }))
    const after = await getDecryptedProviderKey('ak-race', 'openai')

    expect(maybeSingleMock).toHaveBeenCalledTimes(2)
    expect(after?.plaintext).toBe('plain:ct-fresh')
  })
})
