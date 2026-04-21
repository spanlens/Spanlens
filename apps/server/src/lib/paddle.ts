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
    try {
      const parsed = JSON.parse(text) as PaddleError
      if (parsed.error?.detail) detail = parsed.error.detail
    } catch { /* ignore */ }
    throw new Error(`Paddle ${init.method ?? 'GET'} ${path} failed (${res.status}): ${detail}`)
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
