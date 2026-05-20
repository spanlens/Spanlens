/**
 * Cache + coalescing behaviour for `getOrgPlan` and `fetchProviderKeyNames`.
 *
 * These two paths sit on every dashboard read (/requests, /security, /exports)
 * and previously fired one Supabase round-trip per concurrent caller. The
 * coalescing change makes 5+ concurrent callers share one round-trip; the
 * key-names cache adds a 5-minute TTL on top.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const supabaseFromMock = vi.fn()

vi.mock('../lib/db.js', () => ({
  supabaseAdmin: {
    from: (...args: unknown[]) => supabaseFromMock(...args),
  },
}))

// Import after the mock is registered.
const {
  getOrgPlan,
  resetOrgPlanCache,
  fetchProviderKeyNames,
  resetProviderKeyNamesCache,
} = await import('../lib/requests-query.js')

beforeEach(() => {
  resetOrgPlanCache()
  resetProviderKeyNamesCache()
  supabaseFromMock.mockReset()
})

/** Returns a chainable mock that ends in `.single()` resolving to `{ data, error }`. */
function singleChain(data: unknown, error: unknown = null) {
  const chain: Record<string, unknown> = {}
  chain['select'] = () => chain
  chain['eq'] = () => chain
  chain['single'] = () => Promise.resolve({ data, error })
  return chain
}

/** Chainable mock for the org-wide provider_keys SELECT used by the cache. */
function selectAllChain(data: unknown, error: unknown = null) {
  const chain: Record<string, unknown> = {}
  chain['select'] = () => chain
  // Resolve when the caller does `.eq('organization_id', orgId)` — that returns
  // a thenable in supabase-js v2.
  chain['eq'] = () => Promise.resolve({ data, error })
  return chain
}

// ── getOrgPlan ────────────────────────────────────────────────────────────

describe('getOrgPlan — coalescing + 30s cache', () => {
  it('returns the looked-up plan and warms the cache', async () => {
    supabaseFromMock.mockReturnValueOnce(singleChain({ plan: 'pro' }))
    expect(await getOrgPlan('org-1')).toBe('pro')
    // Second call within TTL should not hit Supabase again.
    expect(await getOrgPlan('org-1')).toBe('pro')
    expect(supabaseFromMock).toHaveBeenCalledTimes(1)
  })

  it('falls back to free on a Supabase miss / null data', async () => {
    supabaseFromMock.mockReturnValueOnce(singleChain(null))
    expect(await getOrgPlan('org-x')).toBe('free')
  })

  it('coalesces concurrent callers onto a single Supabase round-trip', async () => {
    // Block the Supabase call so the second caller has a chance to land
    // before the first one finishes — that is the racy window the change fixes.
    let resolveFetch: (val: unknown) => void = () => {}
    const blocker = new Promise((r) => {
      resolveFetch = r
    })
    supabaseFromMock.mockReturnValueOnce({
      select: () => ({
        eq: () => ({
          single: () => blocker,
        }),
      }),
    } as never)

    const p1 = getOrgPlan('org-coalesce')
    const p2 = getOrgPlan('org-coalesce')
    const p3 = getOrgPlan('org-coalesce')

    // All three are now awaiting the same in-flight promise.
    expect(supabaseFromMock).toHaveBeenCalledTimes(1)

    resolveFetch({ data: { plan: 'team' }, error: null })
    expect(await p1).toBe('team')
    expect(await p2).toBe('team')
    expect(await p3).toBe('team')
    expect(supabaseFromMock).toHaveBeenCalledTimes(1) // still one
  })

  it('clears the in-flight map after the fetch settles so the next miss refetches', async () => {
    supabaseFromMock.mockReturnValueOnce(singleChain({ plan: 'free' }))
    await getOrgPlan('org-2')
    resetOrgPlanCache()
    supabaseFromMock.mockReturnValueOnce(singleChain({ plan: 'pro' }))
    expect(await getOrgPlan('org-2')).toBe('pro')
    expect(supabaseFromMock).toHaveBeenCalledTimes(2)
  })
})

// ── fetchProviderKeyNames ─────────────────────────────────────────────────

describe('fetchProviderKeyNames — org-wide 5-min cache', () => {
  it('returns name map for the requested ids', async () => {
    supabaseFromMock.mockReturnValueOnce(
      selectAllChain([
        { id: 'k1', name: 'Production Anthropic' },
        { id: 'k2', name: 'Staging OpenAI' },
      ]),
    )
    const out = await fetchProviderKeyNames('org-1', ['k1', 'k2'])
    expect(out.size).toBe(2)
    expect(out.get('k1')).toBe('Production Anthropic')
    expect(out.get('k2')).toBe('Staging OpenAI')
  })

  it('serves a second request for a subset from cache (no extra Supabase hit)', async () => {
    supabaseFromMock.mockReturnValueOnce(
      selectAllChain([
        { id: 'k1', name: 'Alpha' },
        { id: 'k2', name: 'Beta' },
        { id: 'k3', name: 'Gamma' },
      ]),
    )
    await fetchProviderKeyNames('org-cache', ['k1', 'k2'])
    const second = await fetchProviderKeyNames('org-cache', ['k3'])
    expect(second.get('k3')).toBe('Gamma')
    expect(supabaseFromMock).toHaveBeenCalledTimes(1)
  })

  it('filters the cached map to the ids the caller asked about', async () => {
    supabaseFromMock.mockReturnValueOnce(
      selectAllChain([
        { id: 'k1', name: 'A' },
        { id: 'k2', name: 'B' },
      ]),
    )
    const out = await fetchProviderKeyNames('org-filter', ['k1', 'missing-id'])
    expect(out.size).toBe(1)
    expect(out.has('k1')).toBe(true)
    expect(out.has('missing-id')).toBe(false)
  })

  it('returns an empty map without calling Supabase when keyIds is empty', async () => {
    const out = await fetchProviderKeyNames('org-empty', [])
    expect(out.size).toBe(0)
    expect(supabaseFromMock).not.toHaveBeenCalled()
  })

  it('coalesces concurrent first-callers onto one Supabase fetch', async () => {
    let resolveFetch: (val: unknown) => void = () => {}
    const blocker = new Promise((r) => {
      resolveFetch = r
    })
    supabaseFromMock.mockReturnValueOnce({
      select: () => ({
        eq: () => blocker,
      }),
    } as never)

    const p1 = fetchProviderKeyNames('org-coalesce-keys', ['k1'])
    const p2 = fetchProviderKeyNames('org-coalesce-keys', ['k1'])
    expect(supabaseFromMock).toHaveBeenCalledTimes(1)

    resolveFetch({ data: [{ id: 'k1', name: 'Same' }], error: null })
    expect((await p1).get('k1')).toBe('Same')
    expect((await p2).get('k1')).toBe('Same')
    expect(supabaseFromMock).toHaveBeenCalledTimes(1)
  })

  it('refetches after the cache is reset (mimics the invalidate-on-write hook)', async () => {
    supabaseFromMock.mockReturnValueOnce(selectAllChain([{ id: 'k1', name: 'old' }]))
    await fetchProviderKeyNames('org-reset', ['k1'])

    resetProviderKeyNamesCache()

    supabaseFromMock.mockReturnValueOnce(selectAllChain([{ id: 'k1', name: 'new' }]))
    const out = await fetchProviderKeyNames('org-reset', ['k1'])
    expect(out.get('k1')).toBe('new')
    expect(supabaseFromMock).toHaveBeenCalledTimes(2)
  })
})
