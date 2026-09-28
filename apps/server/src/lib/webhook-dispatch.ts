/**
 * Webhook dispatch with HMAC-SHA256 signing and exponential-backoff retry.
 *
 * Callers:
 *   - webhook-emit.ts            — request.created / trace.completed / alert.triggered
 *   - webhooks.ts /test endpoint — manual test
 *   - cron.ts /retry-webhooks    — automatic retry of failed deliveries
 *
 * Delivery contract (documented at /docs/features/webhooks):
 *   - At most MAX_ATTEMPTS (5) attempts: the original send plus 4 retries,
 *     each retry at least 1, 2, 4 and 8 minutes after the previous failure.
 *     Retries run from /cron/retry-webhooks every 5 minutes.
 *   - Every attempt carries X-Spanlens-Delivery-Id, the webhook_deliveries row
 *     id, unchanged across retries. Delivery is at-least-once, so receivers
 *     dedupe on it.
 *   - A delivery whose last attempt fails is dead-lettered (dlq_at).
 *
 * Outbound requests go through lib/safe-http.ts, which re-validates every
 * redirect hop and checks the resolved address at connect time.
 */

import { supabaseAdmin } from './db.js'
import { safePost } from './safe-http.js'
import { logError } from './structured-logger.js'

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

/** Max delivery attempts (the original send included) before dead-lettering. */
const MAX_ATTEMPTS = 5

/** Budget for one attempt: validation, DNS, every redirect hop, the response. */
const ATTEMPT_TIMEOUT_MS = 10_000

/**
 * How long a claimed delivery stays invisible to other retry runs. At least
 * the function's maxDuration (300s in apps/server/vercel.json), so a run that
 * is still alive never loses its claim. If the run dies, the delivery is
 * claimable again once this lapses.
 */
const CLAIM_LEASE_SECONDS = 300

/** Defaults for one /cron/retry-webhooks run. */
const RETRY_DEFAULTS = {
  /** Sends in flight at once. */
  concurrency: 5,
  /** Deliveries claimed per run; the rest wait for the next tick. */
  maxDeliveries: 50,
  /**
   * No new batch is claimed after this. The last batch finishes within one
   * ATTEMPT_TIMEOUT_MS, which keeps the run well inside the 300s maxDuration.
   */
  deadlineMs: 240_000,
} as const

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

export interface SendWebhookOptions {
  /** webhook_deliveries row id, sent as X-Spanlens-Delivery-Id. */
  deliveryId?: string
}

/** Sends a single webhook attempt. Returns timing + result without writing to DB. */
export async function sendWebhook(
  url: string,
  secret: string,
  payloadObj: Record<string, unknown>,
  options: SendWebhookOptions = {},
): Promise<DispatchResult & { payloadStr: string }> {
  const payloadStr = JSON.stringify(payloadObj)
  const signature = await signPayload(payloadStr, secret)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Spanlens-Signature': `sha256=${signature}`,
    ...(options.deliveryId ? { 'X-Spanlens-Delivery-Id': options.deliveryId } : {}),
  }

  // SSRF defense lives in safePost: the URL is validated at send time (not
  // only at registration), each redirect target is validated before it is
  // followed, and the connection checks the address it actually dials, which
  // is what defeats DNS rebinding. A refusal comes back as `error`, so the
  // delivery is recorded as failed and eventually dead-lettered instead of
  // being sent to an internal target on every retry.
  const startMs = Date.now()
  const { status, error } = await safePost(url, {
    headers,
    body: payloadStr,
    timeoutMs: ATTEMPT_TIMEOUT_MS,
  })
  const ok = error === null && status !== null && status >= 200 && status < 300

  return {
    ok,
    httpStatus: status,
    errorMessage: ok ? null : (error ?? `HTTP ${status}`),
    durationMs: Date.now() - startMs,
    payloadStr,
  }
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
  // The row id is chosen up front so the first attempt can already carry it
  // as X-Spanlens-Delivery-Id, the same id every retry will send.
  const deliveryId = crypto.randomUUID()
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
    { deliveryId },
  )

  const nextRetryAt = !ok
    ? new Date(Date.now() + nextRetryDelayMs(1)).toISOString()
    : null

  const { error } = await supabaseAdmin.from('webhook_deliveries').insert({
    id: deliveryId,
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

  if (error) {
    logError(
      'WEBHOOK_DISPATCH_FAILED',
      { kind: 'delivery_insert', webhookId: webhook.id, eventType },
      error.message,
    )
  }

  return { ok, httpStatus, errorMessage, durationMs, deliveryId: error ? '' : deliveryId }
}

export interface RetryWebhooksResult {
  /** Deliveries claimed this run (sent, or dead-lettered without a send). */
  retried: number
  succeeded: number
  /** Attempts that failed, including the ones counted in `exhausted`. */
  failed: number
  /** Failed on their last allowed attempt and were dead-lettered this run. */
  exhausted: number
  /** Dead-lettered without a send: webhook disabled or deleted, or payload missing. */
  skipped: number
  /** The run stopped claiming because it reached its deadline. */
  deadlineReached: boolean
}

export interface RetryWebhooksOptions {
  concurrency?: number
  maxDeliveries?: number
  deadlineMs?: number
  /** Clock for the deadline. Tests inject one. */
  now?: () => number
}

/** A row returned by claim_webhook_deliveries (20260929120000). */
interface ClaimedDelivery {
  id: string
  webhook_id: string
  event_type: string
  payload: Record<string, unknown> | null
  /** Already includes the attempt this claim is for. */
  attempt_count: number
  claim_token: string
  webhook_url: string | null
  webhook_secret: string | null
  webhook_is_active: boolean | null
}

type RetryOutcome = 'succeeded' | 'failed' | 'exhausted' | 'skipped'

/**
 * Atomically claims up to `limit` due deliveries (FOR UPDATE SKIP LOCKED plus
 * a lease), so overlapping runs split the queue instead of each sending it.
 * A failed claim throws: reporting "nothing to do" would log the run as
 * healthy while the queue silently stops draining.
 */
async function claimDueDeliveries(limit: number): Promise<ClaimedDelivery[]> {
  const { data, error } = await supabaseAdmin.rpc('claim_webhook_deliveries', {
    p_limit: limit,
    p_lease_seconds: CLAIM_LEASE_SECONDS,
    p_max_attempts: MAX_ATTEMPTS,
  })
  if (error) {
    logError('WEBHOOK_FETCH_FAILED', { kind: 'retry_queue_claim' }, error.message)
    throw new Error(`Webhook retry queue claim failed: ${error.message}`)
  }
  return (data ?? []) as ClaimedDelivery[]
}

/**
 * Records an attempt's result and releases the claim. Conditional on the
 * claim token: if this run's lease lapsed and another run took the delivery
 * over, the newer attempt owns the row and this write matches nothing.
 */
async function recordAttempt(
  delivery: ClaimedDelivery,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('webhook_deliveries')
    .update({ ...patch, claimed_until: null, claim_token: null })
    .eq('id', delivery.id)
    .eq('claim_token', delivery.claim_token)

  // The attempt already happened. Log and move on; the lease lapses and the
  // delivery is retried with the same delivery id, which receivers dedupe.
  if (error) {
    logError(
      'WEBHOOK_DISPATCH_FAILED',
      { kind: 'retry_result_write', webhookId: delivery.webhook_id, deliveryId: delivery.id },
      error.message,
    )
  }
}

async function retryOne(delivery: ClaimedDelivery): Promise<RetryOutcome> {
  const { webhook_url: url, webhook_secret: secret, payload } = delivery
  if (!delivery.webhook_is_active || !url || !secret || !payload) {
    // Dead-letter: the webhook was deleted/disabled or the payload row is
    // gone, so no retry can ever succeed. Mark it terminally.
    await recordAttempt(delivery, {
      next_retry_at: null,
      attempt_count: MAX_ATTEMPTS,
      dlq_at: new Date().toISOString(),
      dlq_reason: !payload ? 'payload_missing' : 'webhook_deleted',
    })
    return 'skipped'
  }

  const attempt = delivery.attempt_count
  const { ok, httpStatus, errorMessage, durationMs } = await sendWebhook(url, secret, payload, {
    deliveryId: delivery.id,
  })

  if (ok) {
    await recordAttempt(delivery, {
      status: 'success',
      http_status: httpStatus,
      error_message: null,
      duration_ms: durationMs,
      next_retry_at: null,
    })
    return 'succeeded'
  }

  // When this attempt was the last one, dead-letter it: stop retrying and
  // stamp dlq_at so it's counted + surfaced instead of silently rotting in
  // the failed pile.
  const exhaustedNow = attempt >= MAX_ATTEMPTS
  await recordAttempt(delivery, {
    http_status: httpStatus,
    error_message: errorMessage,
    duration_ms: durationMs,
    next_retry_at: exhaustedNow
      ? null
      : new Date(Date.now() + nextRetryDelayMs(attempt)).toISOString(),
    ...(exhaustedNow ? { dlq_at: new Date().toISOString(), dlq_reason: 'exhausted' } : {}),
  })
  return exhaustedNow ? 'exhausted' : 'failed'
}

const countOf = (outcomes: readonly RetryOutcome[], kind: RetryOutcome): number =>
  outcomes.filter((o) => o === kind).length

/**
 * Retries failed webhook deliveries whose `next_retry_at` is in the past.
 *
 * Claims a batch of `concurrency` deliveries at a time and sends the batch in
 * parallel, until the queue is empty, `maxDeliveries` have been claimed, or
 * `deadlineMs` has passed. Nothing is claimed that this run will not send, so
 * whatever is left stays unclaimed for the next tick.
 *
 * Called by the /cron/retry-webhooks endpoint.
 */
export async function retryFailedWebhooks(
  options: RetryWebhooksOptions = {},
): Promise<RetryWebhooksResult> {
  const concurrency = options.concurrency ?? RETRY_DEFAULTS.concurrency
  const maxDeliveries = options.maxDeliveries ?? RETRY_DEFAULTS.maxDeliveries
  const deadlineMs = options.deadlineMs ?? RETRY_DEFAULTS.deadlineMs
  const now = options.now ?? Date.now
  const startedAt = now()

  let outcomes: RetryOutcome[] = []
  let deadlineReached = false
  while (outcomes.length < maxDeliveries) {
    if (now() - startedAt >= deadlineMs) {
      deadlineReached = true
      break
    }
    const batch = await claimDueDeliveries(Math.min(concurrency, maxDeliveries - outcomes.length))
    if (batch.length === 0) break
    outcomes = [...outcomes, ...(await Promise.all(batch.map(retryOne)))]
  }

  // Page operators if too many deliveries have permanently dead-lettered (an
  // endpoint down long enough to burn through all retries). Best-effort — a
  // failure here must never break the retry cron.
  await alertOnWebhookDlq().catch(() => undefined)

  const exhausted = countOf(outcomes, 'exhausted')
  return {
    retried: outcomes.length,
    succeeded: countOf(outcomes, 'succeeded'),
    failed: countOf(outcomes, 'failed') + exhausted,
    exhausted,
    skipped: countOf(outcomes, 'skipped'),
    deadlineReached,
  }
}

/**
 * Count of dead-lettered webhook deliveries (permanently given up on). Returns
 * `null` when the count query itself fails, so callers can distinguish "zero
 * dead" from "couldn't check" (same convention as /health/deep metrics).
 */
export async function webhookDlqSize(): Promise<number | null> {
  const { count, error } = await supabaseAdmin
    .from('webhook_deliveries')
    .select('id', { count: 'exact', head: true })
    .not('dlq_at', 'is', null)
  if (error) return null
  return count ?? 0
}

/** Dead-letter queue size above which an operator alert is raised. */
export const WEBHOOK_DLQ_ALERT_THRESHOLD = 100

/**
 * Raise an `internal_alerts` row (kind `webhook_backlog`, already declared in
 * 20260609110000_internal_alerts.sql) when the dead-letter queue exceeds
 * `threshold`. Surfaced to operators at /admin/alerts.
 *
 * Deduplicated: if an unresolved `webhook_backlog` alert is already open, this
 * is a no-op — a persistently-down endpoint pages once, not every cron tick.
 * Mirrors `alertOnFallbackBacklog` in lib/fallback-replay.ts.
 */
export async function alertOnWebhookDlq(
  threshold: number = WEBHOOK_DLQ_ALERT_THRESHOLD,
): Promise<{ dlqSize: number | null; alerted: boolean }> {
  const dlqSize = await webhookDlqSize()
  if (dlqSize === null || dlqSize <= threshold) return { dlqSize, alerted: false }

  try {
    const { data: existing } = await supabaseAdmin
      .from('internal_alerts')
      .select('id')
      .eq('kind', 'webhook_backlog')
      .is('resolved_at', null)
      .limit(1)
      .maybeSingle()
    if (existing) return { dlqSize, alerted: false }

    await supabaseAdmin.from('internal_alerts').insert({
      kind: 'webhook_backlog',
      severity: 'error',
      message:
        `Webhook dead-letter queue over ${threshold} ` +
        `(${dlqSize} deliveries permanently failed). An endpoint is likely down or misconfigured.`,
      details: { dlq_size: dlqSize, threshold },
    })
    return { dlqSize, alerted: true }
  } catch (err) {
    logError(
      'WEBHOOK_DLQ_ALERT_FAILED',
      { kind: 'webhook_dlq_alert' },
      err instanceof Error ? err.message : 'unknown',
    )
    return { dlqSize, alerted: false }
  }
}
