import { describe, expect, it } from 'vitest'
import { ApiError } from './api'
import { describeBillingFailure } from './billing-errors'

/**
 * The billing banner used to show whatever string came back, which meant an
 * under-scoped Paddle key reached customers as
 * "502 … not authorized to create|read transaction". These cases pin the two
 * things that has to keep being true: the reader is told whether trying again
 * is worth it, and no failure surfaces a bare `HTTP <status>`.
 */
describe('describeBillingFailure', () => {
  it('passes a configuration failure through and marks it not retryable', () => {
    const message =
      'Checkout is unavailable because of a billing problem on our side. ' +
      'We have been notified. Please contact support@spanlens.io if it persists.'
    const failure = describeBillingFailure(
      new ApiError(message, 503, 'BILLING_NOT_CONFIGURED'),
      'fallback',
    )
    expect(failure).toEqual({ message, retryable: false })
  })

  it('marks an upstream failure retryable', () => {
    const message = 'The payment provider is not responding. Please try again in a few minutes.'
    const failure = describeBillingFailure(
      new ApiError(message, 502, 'UPSTREAM_FAILED'),
      'fallback',
    )
    expect(failure).toEqual({ message, retryable: true })
  })

  it('replaces a bodiless 5xx rather than showing "HTTP 502"', () => {
    // No envelope: an edge timeout or a crashed function never reaches the
    // server's error handler, so `extractErrorMessage` yields the status line.
    const failure = describeBillingFailure(new ApiError('HTTP 502', 502, null), 'fallback')
    expect(failure.message).not.toMatch(/HTTP 502/)
    expect(failure.message).toMatch(/not responding/i)
    expect(failure.retryable).toBe(true)
  })

  it('treats a rejected fetch as a connection problem', () => {
    const failure = describeBillingFailure(new TypeError('Failed to fetch'), 'fallback')
    expect(failure.message).toMatch(/connection/i)
    expect(failure.retryable).toBe(true)
  })

  it('keeps a plan-gate message and does not invite a retry', () => {
    const failure = describeBillingFailure(
      new ApiError('This action requires a higher plan', 402, 'PAYMENT_REQUIRED'),
      'fallback',
    )
    expect(failure).toEqual({ message: 'This action requires a higher plan', retryable: false })
  })

  it('never surfaces the upstream provider detail, whatever the server sends', () => {
    // Belt and braces: the server is responsible for not putting Paddle's words
    // in the envelope, but if one ever leaks the banner should not read like a
    // stack trace either. Any code we do not recognise still yields prose.
    const failure = describeBillingFailure(new ApiError('HTTP 500', 500, null), 'fallback')
    expect(failure.message).not.toMatch(/HTTP \d{3}/)
  })
})
