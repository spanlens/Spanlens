import { ApiError } from '@/lib/api'

/**
 * Turns a failed invitation call into something worth showing.
 *
 * Seat limits made one failure expected rather than exceptional: a workspace
 * that is out of seats answers 402 PAYMENT_REQUIRED, and the server already
 * writes the copy for whoever is reading (the admin sending the invite, or the
 * invitee trying to join). This passes that copy through and adds the one bit
 * the message cannot carry, `seatLimit`, so the admin dialog can offer the way
 * to billing.
 *
 * The invitation routes only return PAYMENT_REQUIRED for the seat limit, so the
 * code alone identifies it.
 */
export interface InvitationFailure {
  message: string
  /** True when the workspace has no free seat on its plan. */
  seatLimit: boolean
}

const UNREACHABLE = 'Could not reach Spanlens. Check your connection and try again.'

function fromCode(
  code: string | null,
  message: string,
  status: number,
  fallback: string,
): InvitationFailure {
  if (code === 'PAYMENT_REQUIRED') return { message, seatLimit: true }
  // No envelope and a 5xx: the request died before the server's error handler
  // (edge timeout, crash), so the message is just "HTTP 502". Replace it.
  if (code === null && status >= 500) return { message: fallback, seatLimit: false }
  return { message: message || fallback, seatLimit: false }
}

/** For calls made through `apiPost` / `apiDelete`, which throw `ApiError`. */
export function describeInvitationFailure(err: unknown, fallback: string): InvitationFailure {
  if (!(err instanceof ApiError)) return { message: UNREACHABLE, seatLimit: false }
  return fromCode(err.code, err.message, err.status, fallback)
}

/**
 * For raw `fetch` callers that read the JSON body themselves. Handles both the
 * unified envelope `{ error: { code, message } }` and the legacy
 * `{ error: '<message>' }`. Rendering `body.error` directly used to put the
 * envelope object itself into React state.
 */
export function describeInvitationResponse(
  body: unknown,
  status: number,
  fallback: string,
): InvitationFailure {
  const err = (body as { error?: unknown } | null | undefined)?.error
  if (typeof err === 'string') return { message: err || fallback, seatLimit: false }
  if (err && typeof err === 'object') {
    const { code, message } = err as { code?: unknown; message?: unknown }
    return fromCode(
      typeof code === 'string' ? code : null,
      typeof message === 'string' ? message : '',
      status,
      fallback,
    )
  }
  return { message: fallback, seatLimit: false }
}
