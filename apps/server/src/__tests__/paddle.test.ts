import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { verifyPaddleSignature, planForPriceId } from '../lib/paddle.js'

// Helpers to generate a valid Paddle-style signature locally so the test doesn't
// depend on the real secret. Mirrors what Paddle does on their end.
async function sign(body: string, ts: string, secret: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret) as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const buf = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(`${ts}:${body}`) as BufferSource,
  )
  const bytes = new Uint8Array(buf)
  let hex = ''
  for (let i = 0; i < bytes.length; i++) hex += bytes[i]!.toString(16).padStart(2, '0')
  return hex
}

describe('verifyPaddleSignature', () => {
  const SECRET = 'pdl_ntfset_test_secret_1234567890'

  beforeEach(() => {
    process.env['PADDLE_NOTIFICATION_SECRET'] = SECRET
  })

  afterEach(() => {
    delete process.env['PADDLE_NOTIFICATION_SECRET']
  })

  it('accepts a valid signature within the timestamp tolerance', async () => {
    const body = JSON.stringify({ event_type: 'subscription.created' })
    const ts = Math.floor(Date.now() / 1000).toString()
    const h1 = await sign(body, ts, SECRET)
    const header = `ts=${ts};h1=${h1}`

    expect(await verifyPaddleSignature(body, header)).toBe(true)
  })

  it('rejects a signature with a tampered body', async () => {
    const body = JSON.stringify({ event_type: 'subscription.created' })
    const ts = Math.floor(Date.now() / 1000).toString()
    const h1 = await sign(body, ts, SECRET)
    const header = `ts=${ts};h1=${h1}`

    expect(
      await verifyPaddleSignature(body + '{"tampered":true}', header),
    ).toBe(false)
  })

  it('rejects a signature signed with a different secret', async () => {
    const body = JSON.stringify({ event_type: 'subscription.created' })
    const ts = Math.floor(Date.now() / 1000).toString()
    const h1 = await sign(body, ts, 'different_secret')
    const header = `ts=${ts};h1=${h1}`

    expect(await verifyPaddleSignature(body, header)).toBe(false)
  })

  it('rejects a timestamp outside the tolerance window (replay protection)', async () => {
    const body = JSON.stringify({ event_type: 'subscription.created' })
    // 1 hour in the past — well beyond the 5-minute default tolerance
    const ts = (Math.floor(Date.now() / 1000) - 3600).toString()
    const h1 = await sign(body, ts, SECRET)
    const header = `ts=${ts};h1=${h1}`

    expect(await verifyPaddleSignature(body, header)).toBe(false)
  })

  it('rejects malformed signature header', async () => {
    expect(await verifyPaddleSignature('{}', 'malformed-header')).toBe(false)
    expect(await verifyPaddleSignature('{}', undefined)).toBe(false)
    expect(await verifyPaddleSignature('{}', '')).toBe(false)
  })

  it('fails closed when PADDLE_NOTIFICATION_SECRET is not configured', async () => {
    delete process.env['PADDLE_NOTIFICATION_SECRET']
    const ts = Math.floor(Date.now() / 1000).toString()
    // Even a "valid" looking signature must be rejected without a secret
    expect(
      await verifyPaddleSignature('{}', `ts=${ts};h1=00`),
    ).toBe(false)
  })
})

describe('planForPriceId', () => {
  beforeEach(() => {
    process.env['PADDLE_PRICE_STARTER'] = 'pri_sandbox_starter_19'
    process.env['PADDLE_PRICE_TEAM'] = 'pri_sandbox_team_49'
    process.env['PADDLE_PRICE_ENTERPRISE'] = 'pri_sandbox_enterprise_99'
  })

  afterEach(() => {
    delete process.env['PADDLE_PRICE_STARTER']
    delete process.env['PADDLE_PRICE_TEAM']
    delete process.env['PADDLE_PRICE_ENTERPRISE']
  })

  it('maps each configured price id to its plan tier', () => {
    expect(planForPriceId('pri_sandbox_starter_19')).toBe('starter')
    expect(planForPriceId('pri_sandbox_team_49')).toBe('team')
    expect(planForPriceId('pri_sandbox_enterprise_99')).toBe('enterprise')
  })

  it('returns null for unknown price ids', () => {
    expect(planForPriceId('pri_unknown')).toBeNull()
    expect(planForPriceId('')).toBeNull()
  })
})
