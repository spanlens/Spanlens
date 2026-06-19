import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The frontend-error sink is public and unauthenticated and is mounted BEFORE
// apiRateLimit in app.ts, so the only thing standing between an anonymous
// client and the structured log drain is the per-IP limiter inside the router.
// Mock checkRateLimit so we can drive both the under-cap and over-cap paths.
const checkRateLimitMock = vi.hoisted(() => vi.fn())
vi.mock('../lib/rate-limit.js', () => ({ checkRateLimit: checkRateLimitMock }))

import { frontendErrorsRouter } from '../api/frontendErrors.js'

function post(ip: string) {
  return frontendErrorsRouter.request('/', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ scope: 'route', message: 'boom' }),
  })
}

beforeEach(() => {
  checkRateLimitMock.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('frontend-errors per-IP rate limit', () => {
  it('under the cap: logs the record and returns 204', async () => {
    checkRateLimitMock.mockResolvedValue(true)
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await post('1.2.3.4')

    expect(res.status).toBe(204)
    expect(errSpy.mock.calls.some((c) => String(c[0]).includes('[frontend-error]'))).toBe(true)
    expect(checkRateLimitMock).toHaveBeenCalledWith('fe-err:1.2.3.4', 30)
  })

  it('over the cap: returns 204 and writes NO log line', async () => {
    checkRateLimitMock.mockResolvedValue(false)
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await post('1.2.3.4')

    expect(res.status).toBe(204)
    expect(errSpy.mock.calls.some((c) => String(c[0]).includes('[frontend-error]'))).toBe(false)
  })

  it('keys the limit on the first x-forwarded-for hop', async () => {
    checkRateLimitMock.mockResolvedValue(true)
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await frontendErrorsRouter.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '9.9.9.9, 10.0.0.1' },
      body: JSON.stringify({ scope: 'route' }),
    })

    expect(checkRateLimitMock).toHaveBeenCalledWith('fe-err:9.9.9.9', 30)
  })
})
