import { getPaddleBase } from './paddle.js'

/**
 * Wrapper over Paddle's one-time charge endpoint.
 *
 *   POST /subscriptions/{id}/charge
 *
 * Used for usage-based overage billing: at the end of a billing period we
 * report the overage quantity as a one-time charge that gets bundled into
 * the next invoice.
 *
 * Docs: https://developer.paddle.com/api-reference/subscriptions/create-one-time-charge
 */

export type ChargeTiming = 'immediately' | 'next_billing_period'

export interface ChargeItem {
  /** price_id of a non-recurring (billing_cycle: null) price. */
  priceId: string
  /** Units to charge for, e.g. ceil(overage_requests / 1000). */
  quantity: number
}

export interface ChargeSuccess {
  ok: true
  /** The full response body from Paddle — persisted to paddle_response for audit. */
  response: unknown
}

export interface ChargeFailure {
  ok: false
  /** HTTP status or 0 for network error. */
  status: number
  error: string
  /** Best-effort: the raw body Paddle returned, for debugging. */
  response?: unknown
}

export type ChargeResult = ChargeSuccess | ChargeFailure

/**
 * Issue a one-time charge against a live Paddle subscription.
 *
 * This is pure "talk to Paddle" — idempotency is the caller's responsibility.
 * The caller is expected to have inserted a pending row into
 * subscription_overage_charges FIRST, guarded by its UNIQUE
 * (subscription_id, period_end) constraint.
 */
export async function chargeSubscription(
  paddleSubscriptionId: string,
  items: ChargeItem[],
  effectiveFrom: ChargeTiming = 'next_billing_period',
): Promise<ChargeResult> {
  const apiKey = process.env['PADDLE_API_KEY']
  if (!apiKey) {
    return { ok: false, status: 0, error: 'PADDLE_API_KEY is not configured' }
  }
  if (items.length === 0) {
    return { ok: false, status: 0, error: 'items array is empty' }
  }

  const url = `${getPaddleBase()}/subscriptions/${paddleSubscriptionId}/charge`
  const body = JSON.stringify({
    effective_from: effectiveFrom,
    items: items.map((i) => ({ price_id: i.priceId, quantity: i.quantity })),
  })

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body,
    })

    const text = await res.text().catch(() => '')
    let parsed: unknown = null
    try {
      parsed = text ? (JSON.parse(text) as unknown) : null
    } catch {
      parsed = text
    }

    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: summarizePaddleError(parsed) ?? `HTTP ${res.status}`,
        response: parsed,
      }
    }
    return { ok: true, response: parsed }
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: err instanceof Error ? err.message : 'network error',
    }
  }
}

function summarizePaddleError(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const errObj = (body as { error?: { detail?: unknown; code?: unknown } }).error
  if (!errObj) return null
  const parts: string[] = []
  if (typeof errObj.code === 'string') parts.push(errObj.code)
  if (typeof errObj.detail === 'string') parts.push(errObj.detail)
  return parts.length > 0 ? parts.join(' — ') : null
}
