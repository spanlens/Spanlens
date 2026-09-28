/**
 * Org-scoped Paddle checkout sessions (quality audit 2026-09-28, C4.1 / C4.2).
 *
 * The checkout route used to guard against double billing only by looking for
 * a live `subscriptions` row. The webhook writes that row after payment, so
 * before payment nothing stopped a second (third, ...) Paddle transaction from
 * being created for the same org, and each one could be paid into its own
 * subscription. `billing_checkout_sessions` closes that gap:
 *
 *   - A partial UNIQUE index allows one 'creating' / 'open' row per org. That
 *     index, not a read-then-write check, is what makes two concurrent
 *     requests safe: the loser's INSERT fails with 23505.
 *   - Within CHECKOUT_REUSE_WINDOW_MS an open session for the same price is
 *     handed back instead of creating a new Paddle transaction; a session for
 *     a different price, or one that was just completed, is refused.
 *   - paddle_transaction_id maps a webhook transaction back to the org that
 *     started it, which the webhook uses when custom_data is missing.
 *   - A session that outlives the window is expired AND its Paddle
 *     transaction is canceled. Marking the row alone left the old link
 *     payable: tab A's checkout, expired when tab B started a new one, could
 *     still be paid after tab B's, and each payment became a subscription.
 *     If the cancel fails, the webhook's duplicate-subscription alert
 *     (lib/billing-plan-anomalies.ts) is the backstop.
 */

import { supabaseAdmin } from './db.js'
import { ApiError } from './errors.js'
import { cancelPaddleTransaction, classifyPaddleFailure, PaddleApiError } from './paddle.js'
import { logError } from './structured-logger.js'

export const CHECKOUT_REUSE_WINDOW_MS = 30 * 60 * 1000

const TABLE = 'billing_checkout_sessions'
const UNIQUE_VIOLATION = '23505'

export type CheckoutSessionStatus = 'creating' | 'open' | 'completed' | 'failed' | 'expired'

export interface RecentCheckoutSession {
  id: string
  price_id: string
  status: CheckoutSessionStatus
  checkout_url: string | null
  paddle_transaction_id: string | null
}

export type CheckoutDecision =
  | { kind: 'reuse'; url: string; transactionId: string }
  | { kind: 'conflict'; message: string }

export type CheckoutReservation =
  | { kind: 'reuse'; url: string; transactionId: string }
  | { kind: 'reserved'; sessionId: string }

export const CHECKOUT_MESSAGES = {
  justCompleted:
    'A payment for this workspace was just completed. Your subscription will appear in a minute or two.',
  inProgress:
    'A checkout for this workspace is already being prepared. Please try again in a moment.',
  otherPlan:
    'A checkout for a different plan was started in the last 30 minutes. ' +
    'Finish that checkout, or try again once it expires.',
} as const

/**
 * What to do when the org already has a checkout from the last
 * CHECKOUT_REUSE_WINDOW_MS. Pure, so the policy is testable on its own.
 */
export function decideOnRecentSession(
  recent: RecentCheckoutSession,
  priceId: string,
): CheckoutDecision {
  if (recent.status === 'completed') {
    return { kind: 'conflict', message: CHECKOUT_MESSAGES.justCompleted }
  }
  const reusable =
    recent.status === 'open' &&
    recent.price_id === priceId &&
    recent.checkout_url !== null &&
    recent.paddle_transaction_id !== null
  if (reusable) {
    return { kind: 'reuse', url: recent.checkout_url!, transactionId: recent.paddle_transaction_id! }
  }
  if (recent.status === 'open' && recent.price_id !== priceId) {
    return { kind: 'conflict', message: CHECKOUT_MESSAGES.otherPlan }
  }
  return { kind: 'conflict', message: CHECKOUT_MESSAGES.inProgress }
}

function internal(orgId: string, stage: string, message: string): ApiError {
  logError('UNCATEGORIZED', { orgId, area: 'billing.checkout', stage, dbError: message })
  return new ApiError('INTERNAL_ERROR', 'Checkout could not be started. Please try again.')
}

async function findRecentSession(orgId: string, cutoffIso: string): Promise<RecentCheckoutSession | null> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select('id, price_id, status, checkout_url, paddle_transaction_id')
    .eq('organization_id', orgId)
    .in('status', ['creating', 'open', 'completed'])
    .gt('created_at', cutoffIso)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw internal(orgId, 'checkout_session.find', error.message)
  return (data as RecentCheckoutSession | null) ?? null
}

/**
 * Cancel the Paddle transaction behind an expired session. Never throws: the
 * new checkout must not be blocked by an old one, and a failure is logged
 * with the transaction id so it can be canceled by hand.
 */
async function cancelAbandonedTransaction(orgId: string, transactionId: string): Promise<void> {
  try {
    await cancelPaddleTransaction(transactionId)
  } catch (err) {
    logError('PADDLE_API_FAILED', {
      orgId,
      stage: 'transaction.cancel',
      kind: classifyPaddleFailure(err),
      paddleTransactionId: transactionId,
      paddleStatus: err instanceof PaddleApiError ? err.status : null,
      paddleCode: err instanceof PaddleApiError ? err.code : null,
    }, err)
  }
}

async function expireStaleSessions(orgId: string, cutoffIso: string): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .update({ status: 'expired' })
    .eq('organization_id', orgId)
    .in('status', ['creating', 'open'])
    .lte('created_at', cutoffIso)
    .select('paddle_transaction_id')
  if (error) throw internal(orgId, 'checkout_session.expire', error.message)

  // Only the rows THIS update moved to expired: a concurrent request that
  // expired them first owns their cancel.
  const transactionIds = ((data ?? []) as Array<{ paddle_transaction_id: string | null }>)
    .map((row) => row.paddle_transaction_id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
  await Promise.all(transactionIds.map((id) => cancelAbandonedTransaction(orgId, id)))
}

/**
 * Claim the org's single checkout slot, or hand back the open session that
 * already holds it. Throws ApiError CONFLICT when a checkout for this org is in
 * a state that must not be duplicated, INTERNAL_ERROR when the table cannot be
 * read or written (fail closed: no Paddle transaction without a claim).
 */
export async function reserveCheckoutSession(
  input: { orgId: string; priceId: string; plan: string; userId: string | null },
  now: Date = new Date(),
): Promise<CheckoutReservation> {
  const cutoffIso = new Date(now.getTime() - CHECKOUT_REUSE_WINDOW_MS).toISOString()

  const recent = await findRecentSession(input.orgId, cutoffIso)
  if (recent) {
    const decision = decideOnRecentSession(recent, input.priceId)
    if (decision.kind === 'reuse') return decision
    throw new ApiError('CONFLICT', decision.message)
  }

  await expireStaleSessions(input.orgId, cutoffIso)

  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .insert({
      organization_id: input.orgId,
      price_id: input.priceId,
      plan: input.plan,
      status: 'creating',
      created_by: input.userId,
    })
    .select('id')
    .single()
  if (error) {
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
      throw new ApiError('CONFLICT', CHECKOUT_MESSAGES.inProgress)
    }
    throw internal(input.orgId, 'checkout_session.insert', error.message)
  }
  return { kind: 'reserved', sessionId: (data as { id: string }).id }
}

/**
 * Record the Paddle transaction on the claimed session. A failure here is
 * logged, not thrown: the customer already has a valid checkout URL, and the
 * session stays 'creating' until it expires, which only makes a retry within
 * the window answer "in progress" instead of reusing the URL.
 */
export async function openCheckoutSession(
  sessionId: string,
  orgId: string,
  tx: { id: string; url: string },
): Promise<void> {
  const { error } = await supabaseAdmin
    .from(TABLE)
    .update({ status: 'open', paddle_transaction_id: tx.id, checkout_url: tx.url })
    .eq('id', sessionId)
  if (error) {
    logError('UNCATEGORIZED', {
      area: 'billing.checkout',
      orgId,
      stage: 'checkout_session.open',
      sessionId,
      paddleTransactionId: tx.id,
      dbError: error.message,
    })
  }
}

/** Release the slot after a failed Paddle call so the next attempt can run. */
export async function failCheckoutSession(sessionId: string, orgId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from(TABLE)
    .update({ status: 'failed' })
    .eq('id', sessionId)
  if (error) {
    logError('UNCATEGORIZED', {
      area: 'billing.checkout',
      orgId,
      stage: 'checkout_session.fail',
      sessionId,
      dbError: error.message,
    })
  }
}

/**
 * Webhook side: the transaction was paid. Logged on failure, never thrown:
 * the subscription write already succeeded and is what entitlement reads.
 */
export async function markCheckoutSessionCompleted(transactionId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from(TABLE)
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('paddle_transaction_id', transactionId)
    .neq('status', 'completed')
  if (error) {
    logError('PADDLE_WEBHOOK_FAILED', {
      stage: 'checkout_session.complete',
      paddleTransactionId: transactionId,
      dbError: error.message,
    })
  }
}

/** Webhook side: exact transaction -> org mapping. Throws on a read failure. */
export async function findOrgIdByCheckoutTransaction(transactionId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select('organization_id')
    .eq('paddle_transaction_id', transactionId)
    .maybeSingle()
  if (error) throw new Error(`checkout session lookup failed: ${error.message}`)
  return (data as { organization_id?: string } | null)?.organization_id ?? null
}
