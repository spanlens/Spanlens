/**
 * Webhook dispatch with HMAC-SHA256 signing and exponential-backoff retry
 * tracking.
 *
 * Callers:
 *   - webhooks.ts /test endpoint — manual test
 *   - cron.ts /retry-webhooks    — automatic retry of failed deliveries
 *   - future event emitters (logger, ingest) for request.created etc.
 */

import { supabaseAdmin } from './db.js'
import { validateOutboundUrl } from './safe-url.js'

export interface WebhookRow {
  id: string
  url: string
  secret: string
}

export interface DispatchResult {
  ok: boolean
  httpStatus: number | null
  errorMessage: string | null
  durationMs: number
}

/** Max delivery attempts before permanently marking as failed. */
const MAX_ATTEMPTS = 5

/**
 * Computes the next retry delay in minutes using exponential back-off.
 * attempt=1 → 1 min, 2 → 2 min, 3 → 4 min, 4 → 8 min.
 */
function nextRetryDelayMs(attempt: number): number {
  return Math.pow(2, attempt - 1) * 60_000
}

/** Builds the HMAC-SHA256 signature for a payload string. */
async function signPayload(payload: string, secret: string): Promise<string> {
  const encoder = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signatureBuffer = await crypto.subtle.sign('HMAC', keyMaterial, encoder.encode(payload))
  return Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Sends a single webhook attempt. Returns timing + result without writing to DB. */
export async function sendWebhook(
  url: string,
  secret: string,
  payloadObj: Record<string, unknown>,
): Promise<DispatchResult & { payloadStr: string }> {
  const payloadStr = JSON.stringify(payloadObj)
  const signature = await signPayload(payloadStr, secret)

  const startMs = Date.now()
  let httpStatus: number | null = null
  let errorMessage: string | null = null
  let ok = false

  // SSRF defense — validate at dispatch time even though registration also
  // validated. DNS rebinding: the hostname's A record may have flipped to a
  // private IP since registration. webhook_deliveries records the rejection
  // (ok:false, errorMessage) so the retry cron will exhaust attempts and
  // stop, instead of hammering an internal target on every retry tick.
  const urlCheck = await validateOutboundUrl(url)
  if (!urlCheck.ok) {
    return {
      ok: false,
      httpStatus: null,
      errorMessage: `URL rejected by SSRF guard: ${urlCheck.message}`,
      durationMs: Date.now() - startMs,
      payloadStr,
    }
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Spanlens-Signature': `sha256=${signature}`,
      },
      body: payloadStr,
      signal: AbortSignal.timeout(10_000),
    })
    httpStatus = res.status
    ok = res.ok
    if (!res.ok) {
      errorMessage = `HTTP ${res.status}`
    }
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : 'Request failed'
  }

  return { ok, httpStatus, errorMessage, durationMs: Date.now() - startMs, payloadStr }
}

/**
 * Dispatches an event to a single webhook endpoint and writes a delivery record.
 *
 * On failure, sets `next_retry_at` for the first attempt so the retry cron
 * can pick it up. Returns the delivery result along with the created delivery
 * row ID (empty string if the insert failed).
 */
export async function dispatchWebhookEvent(
  webhook: WebhookRow,
  eventType: string,
  payloadObj: Record<string, unknown>,
): Promise<DispatchResult & { deliveryId: string }> {
  const fullPayload = {
    ...payloadObj,
    event: eventType,
    timestamp: new Date().toISOString(),
    webhook_id: webhook.id,
  }

  const { ok, httpStatus, errorMessage, durationMs, payloadStr } = await sendWebhook(
    webhook.url,
    webhook.secret,
    fullPayload,
  )

  const nextRetryAt = !ok
    ? new Date(Date.now() + nextRetryDelayMs(1)).toISOString()
    : null

  const { data } = await supabaseAdmin
    .from('webhook_deliveries')
    .insert({
      webhook_id: webhook.id,
      event_type: eventType,
      status: ok ? 'success' : 'failed',
      http_status: httpStatus,
      error_message: errorMessage,
      duration_ms: durationMs,
      payload: JSON.parse(payloadStr) as Record<string, unknown>,
      attempt_count: 1,
      next_retry_at: nextRetryAt,
    })
    .select('id')
    .single()

  return {
    ok,
    httpStatus,
    errorMessage,
    durationMs,
    deliveryId: (data as { id: string } | null)?.id ?? '',
  }
}

/**
 * Retries all failed webhook deliveries whose `next_retry_at` is in the past.
 * Deliveries that have reached MAX_ATTEMPTS are skipped (left as permanently failed).
 *
 * Called by the /cron/retry-webhooks endpoint.
 */
export async function retryFailedWebhooks(): Promise<{
  retried: number
  succeeded: number
  failed: number
  exhausted: number
}> {
  const now = new Date().toISOString()

  // Fetch pending retries (past-due, still under attempt limit)
  const { data: pending, error } = await supabaseAdmin
    .from('webhook_deliveries')
    .select('id, webhook_id, event_type, payload, attempt_count, webhooks(id, url, secret, is_active)')
    .eq('status', 'failed')
    .lte('next_retry_at', now)
    .lt('attempt_count', MAX_ATTEMPTS)
    .limit(50)

  if (error || !pending) {
    console.error('[retryFailedWebhooks] fetch error:', error?.message)
    return { retried: 0, succeeded: 0, failed: 0, exhausted: 0 }
  }

  let succeeded = 0
  let failed = 0

  for (const delivery of pending as unknown as Array<{
    id: string
    webhook_id: string
    event_type: string
    payload: Record<string, unknown> | null
    attempt_count: number
    webhooks: { id: string; url: string; secret: string; is_active: boolean } | null
  }>) {
    const webhook = delivery.webhooks
    if (!webhook?.is_active || !delivery.payload) {
      // Mark exhausted if webhook was deleted/disabled or payload missing
      await supabaseAdmin
        .from('webhook_deliveries')
        .update({ next_retry_at: null, attempt_count: MAX_ATTEMPTS })
        .eq('id', delivery.id)
      continue
    }

    const attempt = delivery.attempt_count + 1
    const { ok, httpStatus, errorMessage, durationMs } = await sendWebhook(
      webhook.url,
      webhook.secret,
      delivery.payload,
    )

    if (ok) {
      await supabaseAdmin
        .from('webhook_deliveries')
        .update({
          status: 'success',
          http_status: httpStatus,
          error_message: null,
          duration_ms: durationMs,
          attempt_count: attempt,
          next_retry_at: null,
        })
        .eq('id', delivery.id)
      succeeded++
    } else {
      const nextRetryAt = attempt >= MAX_ATTEMPTS
        ? null
        : new Date(Date.now() + nextRetryDelayMs(attempt)).toISOString()

      await supabaseAdmin
        .from('webhook_deliveries')
        .update({
          http_status: httpStatus,
          error_message: errorMessage,
          duration_ms: durationMs,
          attempt_count: attempt,
          next_retry_at: nextRetryAt,
        })
        .eq('id', delivery.id)
      failed++
    }
  }

  const exhausted = pending.filter(
    (d) => (d as { attempt_count: number }).attempt_count + 1 >= MAX_ATTEMPTS && failed > 0
  ).length

  return { retried: pending.length, succeeded, failed, exhausted }
}
