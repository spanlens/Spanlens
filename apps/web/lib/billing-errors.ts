import { ApiError } from '@/lib/api'

/**
 * Turns a failed billing call into something worth showing a customer.
 *
 * The billing endpoints answer with the unified error envelope, and the server
 * already writes the prose for the cases it can name, so this mostly passes
 * that through. What it adds is the two things the raw error cannot express:
 *
 *  - `retryable`, so the copy can tell "try again in a minute" apart from
 *    "stop clicking, this one is ours". Those were indistinguishable when every
 *    failure surfaced as the same 502.
 *  - a sentence for the bodiless 5xx. A gateway timeout or a crashed function
 *    never reaches our error handler, so the envelope is missing and the client
 *    was left rendering the literal string "HTTP 502".
 */
export interface BillingFailure {
  message: string
  /** True when clicking the same button again is a reasonable next move. */
  retryable: boolean
}

const UNREACHABLE =
  'Could not reach Spanlens. Check your connection and try again.'
const PROVIDER_DOWN =
  'The payment provider is not responding. Please try again in a few minutes.'

export function describeBillingFailure(err: unknown, fallback: string): BillingFailure {
  if (!(err instanceof ApiError)) {
    // fetch rejected: offline, DNS, TLS, aborted. Never reached the server.
    return { message: UNREACHABLE, retryable: true }
  }

  switch (err.code) {
    // Ours to fix and retrying will not help. The server's message already says
    // so and names support, so it goes through untouched.
    case 'BILLING_NOT_CONFIGURED':
      return { message: err.message, retryable: false }

    case 'UPSTREAM_FAILED':
    case 'UPSTREAM_TIMEOUT':
      return { message: err.message, retryable: true }

    // Plan gate, permission, validation: the message is specific and the
    // customer may be able to act on it, but repeating the call will not change
    // the answer.
    case 'PAYMENT_REQUIRED':
    case 'FORBIDDEN':
    case 'VALIDATION_FAILED':
      return { message: err.message, retryable: false }
  }

  // No code means no envelope, which in practice means the request died before
  // our error handler: an edge timeout, an OOM, a bad gateway. `err.message` is
  // "HTTP 502" here, so replace it rather than show it.
  if (err.code === null && err.status >= 500) {
    return { message: PROVIDER_DOWN, retryable: true }
  }

  return { message: err.message || fallback, retryable: err.status >= 500 }
}
