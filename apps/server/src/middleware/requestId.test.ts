import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { requestId, type RequestIdContext } from './requestId.js'

function makeApp(): Hono<RequestIdContext> {
  const app = new Hono<RequestIdContext>()
  app.use('*', requestId)
  app.get('/', (c) => c.json({ id: c.get('requestId') }))
  return app
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

describe('requestId middleware', () => {
  it('generates a UUIDv4 when no X-Request-ID header is present', async () => {
    const app = makeApp()
    const res = await app.request('/')
    const body = (await res.json()) as { id: string }
    expect(body.id).toMatch(UUID_REGEX)
    expect(res.headers.get('X-Request-ID')).toBe(body.id)
  })

  it('echoes a valid client-supplied X-Request-ID without rewriting it', async () => {
    const app = makeApp()
    // A real upstream gateway value (UUIDv7) — should be preserved verbatim.
    const incoming = '018f5dcb-1234-7890-9abc-def012345678'
    const res = await app.request('/', { headers: { 'X-Request-ID': incoming } })
    const body = (await res.json()) as { id: string }
    expect(body.id).toBe(incoming)
    expect(res.headers.get('X-Request-ID')).toBe(incoming)
  })

  it('rejects a malformed client-supplied id and generates a fresh one', async () => {
    const app = makeApp()
    // Garbage that could break log correlation if we trusted it.
    const res = await app.request('/', { headers: { 'X-Request-ID': '../../etc/passwd' } })
    const body = (await res.json()) as { id: string }
    expect(body.id).not.toBe('../../etc/passwd')
    expect(body.id).toMatch(UUID_REGEX)
  })

  it('issues distinct ids across two consecutive requests', async () => {
    const app = makeApp()
    const a = (await (await app.request('/')).json()) as { id: string }
    const b = (await (await app.request('/')).json()) as { id: string }
    expect(a.id).not.toBe(b.id)
  })
})
