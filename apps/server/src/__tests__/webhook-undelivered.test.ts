import { beforeEach, describe, expect, test, vi } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// recordUndeliveredWebhookEvent (lib/webhook-dispatch.ts): the delivery row a
// caller writes for an event it had no time left to send (the fallback
// replay's announce budget). The row has to look like one retryFailedWebhooks
// picks up, carry the same body a live send would, and never throw.
//
// Supabase mocks follow the real supabase-js contract: a failed write
// RESOLVES with `{ error }`, it does not reject.
// ─────────────────────────────────────────────────────────────────────────────

const insertMock = vi.fn()

vi.mock('../lib/db.js', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table !== 'webhook_deliveries') throw new Error(`unexpected table ${table}`)
      return { insert: (row: unknown) => insertMock(row) }
    },
  },
}))

let recordUndeliveredWebhookEvent: typeof import('../lib/webhook-dispatch.js').recordUndeliveredWebhookEvent

const webhook = { id: 'w1', url: 'https://hooks.example.com/w1', secret: 'secret-w1' }

beforeEach(async () => {
  vi.resetModules()
  vi.restoreAllMocks()
  insertMock.mockReset().mockResolvedValue({ error: null })
  ;({ recordUndeliveredWebhookEvent } = await import('../lib/webhook-dispatch.js'))
})

describe('recordUndeliveredWebhookEvent', () => {
  test('writes a failed, never-attempted delivery that is due for the retry job now', async () => {
    const before = Date.now()

    await recordUndeliveredWebhookEvent(webhook, 'request.created', { request: { id: 'r1' } }, 'out of time')

    expect(insertMock).toHaveBeenCalledOnce()
    const row = insertMock.mock.calls[0]![0] as Record<string, unknown>
    expect(row['webhook_id']).toBe('w1')
    expect(row['event_type']).toBe('request.created')
    expect(row['status']).toBe('failed')
    expect(row['attempt_count']).toBe(0)
    expect(row['http_status']).toBeNull()
    expect(row['error_message']).toBe('out of time')
    expect(Date.parse(String(row['next_retry_at']))).toBeGreaterThanOrEqual(before - 1000)
    expect(Date.parse(String(row['next_retry_at']))).toBeLessThanOrEqual(Date.now())
    // The body a live send would have signed, envelope included.
    expect(row['payload']).toMatchObject({
      request: { id: 'r1' },
      event: 'request.created',
      webhook_id: 'w1',
    })
    expect(typeof (row['payload'] as Record<string, unknown>)['timestamp']).toBe('string')
  })

  test('an insert resolving { error } is logged, not thrown', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    insertMock.mockResolvedValue({ error: { message: 'permission denied' } })

    await expect(
      recordUndeliveredWebhookEvent(webhook, 'request.created', {}, 'out of time'),
    ).resolves.toBeUndefined()
    expect(errorSpy.mock.calls.map((c) => String(c[0])).join('\n')).toContain('WEBHOOK_DISPATCH_FAILED')
  })

  test('a client that throws is logged, not thrown', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    insertMock.mockRejectedValue(new Error('fetch failed'))

    await expect(
      recordUndeliveredWebhookEvent(webhook, 'request.created', {}, 'out of time'),
    ).resolves.toBeUndefined()
  })
})
