import { beforeEach, describe, expect, test, vi } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// Tests for the outbound webhook emitter (lib/webhook-emit.ts):
//   - fans out to webhooks subscribed to the event, skips the rest
//   - no-op when the org has no (matching) webhooks
//   - per-org cache avoids re-querying; invalidateWebhookCache forces a refetch
//   - best-effort: fetch errors and dispatch failures never throw
// ─────────────────────────────────────────────────────────────────────────────

const dispatchMock = vi.fn()
let webhooksResult: { data: unknown; error: unknown }
let fetchCount = 0

vi.mock('../lib/db.js', () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => {
            fetchCount++
            return Promise.resolve(webhooksResult)
          },
        }),
      }),
    }),
  },
}))

vi.mock('../lib/webhook-dispatch.js', () => ({
  dispatchWebhookEvent: (...args: unknown[]) => dispatchMock(...args),
}))

type Emit = typeof import('../lib/webhook-emit.js').emitWebhookEvent
type Invalidate = typeof import('../lib/webhook-emit.js').invalidateWebhookCache

let emitWebhookEvent: Emit
let invalidateWebhookCache: Invalidate

const hook = (id: string, events: string[]) => ({
  id,
  url: `https://hooks.example.com/${id}`,
  secret: `secret-${id}`,
  events,
})

beforeEach(async () => {
  vi.resetModules()
  dispatchMock.mockReset().mockResolvedValue('delivery-id')
  fetchCount = 0
  webhooksResult = { data: [], error: null }
  const mod = await import('../lib/webhook-emit.js')
  emitWebhookEvent = mod.emitWebhookEvent
  invalidateWebhookCache = mod.invalidateWebhookCache
})

describe('emitWebhookEvent', () => {
  test('dispatches to a webhook subscribed to the event', async () => {
    webhooksResult = { data: [hook('w1', ['request.created'])], error: null }

    await emitWebhookEvent('org1', 'request.created', { request: { id: 'r1' } })

    expect(dispatchMock).toHaveBeenCalledTimes(1)
    expect(dispatchMock).toHaveBeenCalledWith(
      { id: 'w1', url: 'https://hooks.example.com/w1', secret: 'secret-w1' },
      'request.created',
      { request: { id: 'r1' } },
    )
  })

  test('skips webhooks not subscribed to the event', async () => {
    webhooksResult = { data: [hook('w1', ['trace.completed'])], error: null }

    await emitWebhookEvent('org1', 'request.created', {})

    expect(dispatchMock).not.toHaveBeenCalled()
  })

  test('fans out to every matching webhook', async () => {
    webhooksResult = {
      data: [
        hook('w1', ['request.created']),
        hook('w2', ['request.created', 'alert.triggered']),
        hook('w3', ['alert.triggered']),
      ],
      error: null,
    }

    await emitWebhookEvent('org1', 'request.created', {})

    expect(dispatchMock).toHaveBeenCalledTimes(2)
  })

  test('no-op when org has no webhooks', async () => {
    webhooksResult = { data: [], error: null }

    await emitWebhookEvent('org1', 'request.created', {})

    expect(dispatchMock).not.toHaveBeenCalled()
  })

  test('short-circuits on empty orgId without querying', async () => {
    await emitWebhookEvent('', 'request.created', {})

    expect(fetchCount).toBe(0)
    expect(dispatchMock).not.toHaveBeenCalled()
  })

  test('caches per org — a second emit does not re-query', async () => {
    webhooksResult = { data: [hook('w1', ['request.created'])], error: null }

    await emitWebhookEvent('org1', 'request.created', {})
    await emitWebhookEvent('org1', 'request.created', {})

    expect(fetchCount).toBe(1)
    expect(dispatchMock).toHaveBeenCalledTimes(2)
  })

  test('invalidateWebhookCache forces a refetch', async () => {
    webhooksResult = { data: [hook('w1', ['request.created'])], error: null }

    await emitWebhookEvent('org1', 'request.created', {})
    invalidateWebhookCache('org1')
    await emitWebhookEvent('org1', 'request.created', {})

    expect(fetchCount).toBe(2)
  })

  test('swallows fetch errors (best-effort, never throws)', async () => {
    webhooksResult = { data: null, error: { message: 'boom' } }

    await expect(emitWebhookEvent('org1', 'request.created', {})).resolves.toBeUndefined()
    expect(dispatchMock).not.toHaveBeenCalled()
  })

  test('swallows dispatch failures', async () => {
    webhooksResult = { data: [hook('w1', ['request.created'])], error: null }
    dispatchMock.mockRejectedValueOnce(new Error('endpoint down'))

    await expect(emitWebhookEvent('org1', 'request.created', {})).resolves.toBeUndefined()
  })
})
