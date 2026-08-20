/**
 * Paddle Billing API client (Edge-compatible, fetch-based).
 *
 * 한국 개인사업자가 Stripe 가입 불가라 Paddle(Merchant of Record)을 채택.
 * Paddle이 VAT/세금 대행 + 한국 은행 페이아웃 지원.
 *
 * 환경변수:
 *   PADDLE_API_KEY             Paddle Dashboard → Developer Tools → Authentication
 *   PADDLE_NOTIFICATION_SECRET 웹훅 HMAC 서명 검증용
 *   PADDLE_ENVIRONMENT         'sandbox' | 'production' (기본 'sandbox')
 */

const SANDBOX_BASE = 'https://sandbox-api.paddle.com'
const PRODUCTION_BASE = 'https://api.paddle.com'

export function getPaddleBase(): string {
  const env = process.env['PADDLE_ENVIRONMENT'] ?? 'sandbox'
  return env === 'production' ? PRODUCTION_BASE : SANDBOX_BASE
}

function getPaddleKey(): string {
  const key = process.env['PADDLE_API_KEY']
  if (!key) throw new Error('PADDLE_API_KEY is not configured')
  return key
}

interface PaddleError {
  error?: { type?: string; code?: string; detail?: string }
}

/**
 * A non-2xx from the Paddle API, with the status kept separate from the prose.
 *
 * Callers need the status to tell "our key is wrong" from "Paddle is down",
 * because those are a different message to the customer and a different job for
 * us. Parsing that back out of a concatenated string is how error handling
 * rots, so it travels as a field.
 *
 * `detail` is Paddle's own explanation. It is safe to log and must not be
 * forwarded to a browser: it describes our credentials and configuration, not
 * anything the customer did.
 */
export class PaddleApiError extends Error {
  readonly name = 'PaddleApiError'

  constructor(
    readonly status: number,
    readonly detail: string,
    readonly method: string,
    readonly path: string,
    readonly code: string | null = null,
  ) {
    super(`Paddle ${method} ${path} failed (${status}): ${detail}`)
  }
}

/**
 * What kind of problem a Paddle failure is, from the point of view of whoever
 * has to act on it.
 *
 *   credentials — the API key is missing, expired, or lacks a permission.
 *                 Nobody but us can fix it, and retrying will not help.
 *   unavailable — Paddle is erroring or unreachable. Retrying is reasonable.
 *   request     — Paddle rejected the specific call: a stale customer id, an
 *                 unknown price, a malformed body. Ours to fix, but scoped to
 *                 this org rather than the whole integration.
 *
 * A key with too few permissions answers 403, which is why credentials covers
 * both 401 and 403: an expired key and an under-scoped one are the same job.
 */
export type PaddleFailureKind = 'credentials' | 'unavailable' | 'request'

export function classifyPaddleFailure(err: unknown): PaddleFailureKind {
  if (!(err instanceof PaddleApiError)) {
    // A thrown non-PaddleApiError here is a fetch rejection — DNS, TLS, socket,
    // abort. Paddle is unreachable rather than unhappy.
    return 'unavailable'
  }
  if (err.status === 401 || err.status === 403) return 'credentials'
  if (err.status === 408 || err.status === 429 || err.status >= 500) return 'unavailable'
  return 'request'
}

async function paddleFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${getPaddleBase()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${getPaddleKey()}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })

  const text = await res.text()
  if (!res.ok) {
    let detail = text.slice(0, 500)
    let code: string | null = null
    try {
      const parsed = JSON.parse(text) as PaddleError
      if (parsed.error?.detail) detail = parsed.error.detail
      if (parsed.error?.code) code = parsed.error.code
    } catch { /* ignore */ }
    throw new PaddleApiError(res.status, detail, init.method ?? 'GET', path, code)
  }

  return (text ? JSON.parse(text) : null) as T
}

// ── Customer helpers ─────────────────────────────────────────────

export interface PaddleCustomer {
  id: string  // ctm_...
  email: string
  name: string | null
  status: 'active' | 'archived'
}

interface PaddleEnvelope<T> { data: T }

export async function createPaddleCustomer(params: {
  email: string
  name?: string
}): Promise<PaddleCustomer> {
  const body = JSON.stringify({
    email: params.email,
    ...(params.name ? { name: params.name } : {}),
  })
  const res = await paddleFetch<PaddleEnvelope<PaddleCustomer>>('/customers', {
    method: 'POST',
    body,
  })
  return res.data
}

export async function findPaddleCustomerByEmail(email: string): Promise<PaddleCustomer | null> {
  const params = new URLSearchParams({ email })
  const res = await paddleFetch<PaddleEnvelope<PaddleCustomer[]>>(
    `/customers?${params.toString()}`,
  )
  return res.data[0] ?? null
}

// ── Transaction / Checkout helpers ───────────────────────────────

export interface PaddleTransaction {
  id: string
  status: string
  checkout: { url: string } | null
}

export interface PaddleSubscriptionDetail {
  id: string
  customer_id: string
  status: string
  items?: Array<{ price?: { id?: string }; price_id?: string }>
  current_billing_period?: {
    starts_at: string
    ends_at: string
  }
  scheduled_change?: { action: 'cancel' | 'pause' | 'resume' } | null
  custom_data?: { organization_id?: string } | null
}

/**
 * Fetch subscription details from Paddle.
 * Used by the webhook handler when a transaction.completed event arrives
 * without billing period info — we call this to enrich the synthetic sub
 * we build from the transaction.
 */
export async function fetchPaddleSubscription(
  subscriptionId: string,
): Promise<PaddleSubscriptionDetail | null> {
  try {
    const res = await paddleFetch<PaddleEnvelope<PaddleSubscriptionDetail>>(
      `/subscriptions/${subscriptionId}`,
    )
    return res.data
  } catch {
    return null
  }
}

/**
 * Creates a Paddle transaction (subscription checkout) for a customer + price.
 * Returns the transaction with a hosted checkout URL that the user is redirected to.
 *
 * NOTE: Do NOT pass `checkout.url` here. That field is for Paddle.js overlay/inline
 * checkout only. For hosted checkout (redirect-based), omit it so Paddle generates
 * and returns its own hosted checkout URL in `data.checkout.url`. After payment,
 * Paddle redirects the customer to the "Default payment link" configured in the
 * Paddle Dashboard → Checkout Settings.
 */
export async function createPaddleCheckoutTransaction(params: {
  customerId: string
  priceId: string
  organizationId: string  // passed through for webhook → DB correlation
}): Promise<PaddleTransaction> {
  const body: Record<string, unknown> = {
    customer_id: params.customerId,
    items: [{ price_id: params.priceId, quantity: 1 }],
    custom_data: { organization_id: params.organizationId },
  }

  const res = await paddleFetch<PaddleEnvelope<PaddleTransaction>>('/transactions', {
    method: 'POST',
    body: JSON.stringify(body),
  })
  return res.data
}

// ── Signature verification (Edge-compatible, Web Crypto HMAC-SHA256) ──
//
// Paddle sends `Paddle-Signature: ts=<unix>;h1=<hex>` header on each webhook.
// We rebuild the signed payload (`${ts}:${raw_body}`), HMAC-SHA256 it with
// PADDLE_NOTIFICATION_SECRET, and compare constant-time to `h1`.

function parseSignatureHeader(header: string): { ts: string; h1: string } | null {
  const parts = header.split(';').map((p) => p.trim())
  const ts = parts.find((p) => p.startsWith('ts='))?.slice(3)
  const h1 = parts.find((p) => p.startsWith('h1='))?.slice(3)
  if (!ts || !h1) return null
  return { ts, h1 }
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

function bytesToHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let out = ''
  for (let i = 0; i < bytes.length; i++) out += bytes[i]!.toString(16).padStart(2, '0')
  return out
}

export async function verifyPaddleSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  toleranceSeconds = 300,
): Promise<boolean> {
  if (!signatureHeader) return false
  const parsed = parseSignatureHeader(signatureHeader)
  if (!parsed) return false

  const secret = process.env['PADDLE_NOTIFICATION_SECRET']
  if (!secret) return false

  // Replay protection — reject if timestamp drifts too far from now
  const tsNumber = Number(parsed.ts)
  if (!Number.isFinite(tsNumber)) return false
  const nowSec = Math.floor(Date.now() / 1000)
  if (Math.abs(nowSec - tsNumber) > toleranceSeconds) return false

  const encoder = new TextEncoder()
  const keyData = encoder.encode(secret)
  const key = await crypto.subtle.importKey(
    'raw',
    keyData as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signed = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(`${parsed.ts}:${rawBody}`) as BufferSource,
  )
  const expected = bytesToHex(signed)

  return timingSafeEqualHex(expected, parsed.h1)
}

// ── Subscription management ──────────────────────────────────────

/**
 * Cancel a Paddle subscription.
 * Defaults to next_billing_period so the customer keeps access through the
 * end of the current period (matches our Terms: "access until period end").
 */
export async function cancelPaddleSubscription(
  subscriptionId: string,
  effectiveFrom: 'immediately' | 'next_billing_period' = 'next_billing_period',
): Promise<void> {
  await paddleFetch<unknown>(`/subscriptions/${subscriptionId}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ effective_from: effectiveFrom }),
  })
}

// ── Price ID → plan tier mapping ─────────────────────────────────
//
// Set these in env vars after creating prices in the Paddle dashboard:
//   PADDLE_PRICE_STARTER
//   PADDLE_PRICE_TEAM
//   PADDLE_PRICE_ENTERPRISE

export type PlanTier = 'starter' | 'team' | 'enterprise'

export function planForPriceId(priceId: string): PlanTier | null {
  if (priceId === process.env['PADDLE_PRICE_STARTER']) return 'starter'
  if (priceId === process.env['PADDLE_PRICE_TEAM']) return 'team'
  if (priceId === process.env['PADDLE_PRICE_ENTERPRISE']) return 'enterprise'
  return null
}
