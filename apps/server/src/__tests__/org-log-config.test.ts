import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// Mock the Supabase client the module reads body_sample_rate from.
let maybeSingleResult: { data: unknown; error: unknown }
let selectCalls = 0

vi.mock('../lib/db.js', () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => {
        selectCalls++
        return {
          eq: () => ({
            maybeSingle: () => Promise.resolve(maybeSingleResult),
          }),
        }
      },
    }),
  },
}))

type Mod = typeof import('../lib/org-log-config.js')
let getOrgBodySampleRate: Mod['getOrgBodySampleRate']
let resetOrgLogConfigCache: Mod['resetOrgLogConfigCache']
let shouldStoreBody: Mod['shouldStoreBody']

beforeEach(async () => {
  vi.resetModules()
  selectCalls = 0
  maybeSingleResult = { data: { body_sample_rate: 0.25 }, error: null }
  const mod = await import('../lib/org-log-config.js')
  getOrgBodySampleRate = mod.getOrgBodySampleRate
  resetOrgLogConfigCache = mod.resetOrgLogConfigCache
  shouldStoreBody = mod.shouldStoreBody
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('getOrgBodySampleRate', () => {
  test('returns the stored rate', async () => {
    expect(await getOrgBodySampleRate('org1')).toBe(0.25)
  })

  test('caches — a second call does not re-query', async () => {
    await getOrgBodySampleRate('org1')
    await getOrgBodySampleRate('org1')
    expect(selectCalls).toBe(1)
  })

  test('resetOrgLogConfigCache forces a refetch', async () => {
    await getOrgBodySampleRate('org1')
    resetOrgLogConfigCache('org1')
    await getOrgBodySampleRate('org1')
    expect(selectCalls).toBe(2)
  })

  test('clamps out-of-range values into [0, 1]', async () => {
    maybeSingleResult = { data: { body_sample_rate: 1.7 }, error: null }
    expect(await getOrgBodySampleRate('org-high')).toBe(1)

    maybeSingleResult = { data: { body_sample_rate: -0.5 }, error: null }
    expect(await getOrgBodySampleRate('org-low')).toBe(0)
  })

  test('numeric strings (Supabase NUMERIC) are coerced', async () => {
    maybeSingleResult = { data: { body_sample_rate: '0.1' }, error: null }
    expect(await getOrgBodySampleRate('org-str')).toBeCloseTo(0.1, 6)
  })

  test('fails open to 1.0 when the row is missing', async () => {
    maybeSingleResult = { data: null, error: null }
    expect(await getOrgBodySampleRate('org-missing')).toBe(1.0)
  })

  test('fails open to 1.0 on a query error', async () => {
    maybeSingleResult = { data: null, error: { message: 'db down' } }
    expect(await getOrgBodySampleRate('org-err')).toBe(1.0)
  })
})

describe('shouldStoreBody', () => {
  test('never stores when not in full logBody mode', () => {
    expect(shouldStoreBody(false, 1, 0)).toBe(false)
  })

  test('always stores at rate >= 1', () => {
    expect(shouldStoreBody(true, 1, 0.99)).toBe(true)
  })

  test('never stores at rate <= 0', () => {
    expect(shouldStoreBody(true, 0, 0)).toBe(false)
  })

  test('stores when the draw falls under the rate', () => {
    expect(shouldStoreBody(true, 0.3, 0.29)).toBe(true)
    expect(shouldStoreBody(true, 0.3, 0.31)).toBe(false)
  })
})
