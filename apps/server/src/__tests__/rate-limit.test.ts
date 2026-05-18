import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// `slidingWindow` factory returns a configuration object the Ratelimit
// constructor accepts. We capture its arguments so the test can assert the
// window length without depending on Upstash internals.
const slidingWindowCalls: Array<[number, string]> = []

vi.mock('@upstash/redis', () => {
  return {
    Redis: class {
      url: string
      token: string
      constructor(opts: { url: string; token: string }) {
        this.url = opts.url
        this.token = opts.token
      }
    },
  }
})

vi.mock('@upstash/ratelimit', () => {
  class Ratelimit {
    static slidingWindow(limit: number, window: string) {
      slidingWindowCalls.push([limit, window])
      return { __kind: 'slidingWindow', limit, window }
    }

    limiter: { __kind: string; limit: number; window: string }
    prefix: string
    // Used per-test to stub limit() behavior
    static __nextResult: { success: boolean } | Error | null = null

    constructor(opts: {
      redis: unknown
      limiter: { __kind: string; limit: number; window: string }
      prefix: string
    }) {
      this.limiter = opts.limiter
      this.prefix = opts.prefix
    }

    async limit(_key: string): Promise<{ success: boolean }> {
      const res = Ratelimit.__nextResult
      if (res instanceof Error) throw res
      if (res) return res
      return { success: true }
    }
  }

  return { Ratelimit }
})

// Helper to fully reset the rate-limit module state between tests
async function freshRateLimit(env: Record<string, string | undefined>) {
  // Apply env BEFORE importing — rate-limit lazily reads on first call
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  // Drop the module cache so `_redis` / `_limiters` start empty
  vi.resetModules()
  slidingWindowCalls.length = 0
  return await import('../lib/rate-limit.js')
}

async function setNextResult(result: { success: boolean } | Error | null) {
  const mod = await import('@upstash/ratelimit')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(mod.Ratelimit as any).__nextResult = result
}

describe('checkRateLimit', () => {
  const ORIGINAL_ENV = { ...process.env }

  beforeEach(() => {
    // Quiet error logs during the fail-open assertion
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
    vi.restoreAllMocks()
  })

  describe('Redis configured (KV env set)', () => {
    it('returns false when the limiter reports success=false (over limit → 429 path)', async () => {
      const { checkRateLimit } = await freshRateLimit({
        KV_REST_API_URL: 'https://example.upstash.io',
        KV_REST_API_TOKEN: 'token_x',
      })
      await setNextResult({ success: false })

      const allowed = await checkRateLimit('proxy:org-1', 60)

      expect(allowed).toBe(false)
    })

    it('returns true when the limiter reports success=true (under limit)', async () => {
      const { checkRateLimit } = await freshRateLimit({
        KV_REST_API_URL: 'https://example.upstash.io',
        KV_REST_API_TOKEN: 'token_x',
      })
      await setNextResult({ success: true })

      expect(await checkRateLimit('proxy:org-1', 60)).toBe(true)
    })

    it('uses sliding window with a 60s window (P1.1 spec)', async () => {
      const { checkRateLimit } = await freshRateLimit({
        KV_REST_API_URL: 'https://example.upstash.io',
        KV_REST_API_TOKEN: 'token_x',
      })
      await setNextResult({ success: true })

      // Three distinct limits → three Ratelimit instances → three
      // slidingWindow() factory calls, each with the same 60s window.
      await checkRateLimit('proxy:org-free', 60)
      await checkRateLimit('proxy:org-starter', 300)
      await checkRateLimit('api:abc', 120)

      expect(slidingWindowCalls).toEqual([
        [60, '60 s'],
        [300, '60 s'],
        [120, '60 s'],
      ])
    })

    it('caches the limiter per limit value (does not rebuild on every call)', async () => {
      const { checkRateLimit } = await freshRateLimit({
        KV_REST_API_URL: 'https://example.upstash.io',
        KV_REST_API_TOKEN: 'token_x',
      })
      await setNextResult({ success: true })

      await checkRateLimit('proxy:a', 60)
      await checkRateLimit('proxy:b', 60)
      await checkRateLimit('proxy:c', 60)

      // Single slidingWindow build for all three calls at the same limit
      expect(slidingWindowCalls).toEqual([[60, '60 s']])
    })
  })

  describe('Redis not configured (KV env missing — dev / misconfigured prod)', () => {
    it('fails open (returns true) when KV_REST_API_URL is missing', async () => {
      const { checkRateLimit } = await freshRateLimit({
        KV_REST_API_URL: undefined,
        KV_REST_API_TOKEN: 'token_x',
      })

      expect(await checkRateLimit('proxy:any', 60)).toBe(true)
      // Sliding-window factory must NOT have been invoked when Redis is absent
      expect(slidingWindowCalls).toHaveLength(0)
    })

    it('fails open when KV_REST_API_TOKEN is missing', async () => {
      const { checkRateLimit } = await freshRateLimit({
        KV_REST_API_URL: 'https://example.upstash.io',
        KV_REST_API_TOKEN: undefined,
      })

      expect(await checkRateLimit('proxy:any', 60)).toBe(true)
      expect(slidingWindowCalls).toHaveLength(0)
    })

    it('fails open when both env vars are missing', async () => {
      const { checkRateLimit } = await freshRateLimit({
        KV_REST_API_URL: undefined,
        KV_REST_API_TOKEN: undefined,
      })

      expect(await checkRateLimit('proxy:any', 60)).toBe(true)
      expect(slidingWindowCalls).toHaveLength(0)
    })
  })

  describe('Redis configured but throws at runtime (KV down)', () => {
    it('fails open with a console.error and returns true', async () => {
      const errSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {})

      const { checkRateLimit } = await freshRateLimit({
        KV_REST_API_URL: 'https://example.upstash.io',
        KV_REST_API_TOKEN: 'token_x',
      })
      await setNextResult(new Error('ECONNREFUSED'))

      const allowed = await checkRateLimit('proxy:org-1', 60)

      expect(allowed).toBe(true)
      expect(errSpy).toHaveBeenCalledWith(
        '[rate-limit] Redis error — failing open:',
        expect.any(Error),
      )
    })

    it('subsequent successful calls still work after a transient error', async () => {
      const { checkRateLimit } = await freshRateLimit({
        KV_REST_API_URL: 'https://example.upstash.io',
        KV_REST_API_TOKEN: 'token_x',
      })

      await setNextResult(new Error('transient'))
      expect(await checkRateLimit('proxy:a', 60)).toBe(true)

      await setNextResult({ success: false })
      expect(await checkRateLimit('proxy:a', 60)).toBe(false)

      await setNextResult({ success: true })
      expect(await checkRateLimit('proxy:a', 60)).toBe(true)
    })
  })
})
