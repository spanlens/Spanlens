import { describe, expect, it } from 'vitest'
import { ApiError } from './api'
import { describeInvitationFailure, describeInvitationResponse } from './invitation-errors'

/**
 * Seat limits made invitations fail in a new, expected way: a 402 whose
 * message the server writes for the reader. These pin what the invite dialog,
 * the pending-invitation banner and the /invite page do with it, and that the
 * /invite page no longer tries to render the error envelope object itself.
 */
const SEAT_MESSAGE =
  'Your Pro plan includes 3 seats, and this workspace is using 3 (members plus pending ' +
  'invitations). Upgrade the plan, remove a member, or cancel a pending invitation to invite ' +
  'someone new.'

describe('describeInvitationFailure', () => {
  it('flags a seat limit so the UI can point at billing, keeping the server copy', () => {
    const failure = describeInvitationFailure(
      new ApiError(SEAT_MESSAGE, 402, 'PAYMENT_REQUIRED'),
      'Failed to invite',
    )
    expect(failure).toEqual({ message: SEAT_MESSAGE, seatLimit: true })
  })

  it('passes other server errors through without the seat flag', () => {
    const failure = describeInvitationFailure(
      new ApiError('A pending invitation for this email already exists', 409, 'CONFLICT'),
      'Failed to invite',
    )
    expect(failure).toEqual({
      message: 'A pending invitation for this email already exists',
      seatLimit: false,
    })
  })

  it('never shows a bare "HTTP 502"', () => {
    const failure = describeInvitationFailure(new ApiError('HTTP 502', 502, null), 'Failed to invite')
    expect(failure.message).toBe('Failed to invite')
    expect(failure.seatLimit).toBe(false)
  })

  it('explains a network failure', () => {
    const failure = describeInvitationFailure(new TypeError('Failed to fetch'), 'Failed to invite')
    expect(failure.message).toMatch(/could not reach spanlens/i)
  })
})

describe('describeInvitationResponse', () => {
  it('reads the message out of the error envelope instead of returning the object', () => {
    const failure = describeInvitationResponse(
      { error: { code: 'PAYMENT_REQUIRED', message: SEAT_MESSAGE, details: { reason: 'seat_limit_reached' } } },
      402,
      'Failed to accept invitation.',
    )
    expect(failure).toEqual({ message: SEAT_MESSAGE, seatLimit: true })
    expect(typeof failure.message).toBe('string')
  })

  it('still reads the legacy string shape', () => {
    expect(
      describeInvitationResponse({ error: 'Invitation expired' }, 400, 'fallback'),
    ).toEqual({ message: 'Invitation expired', seatLimit: false })
  })

  it('falls back when the body is empty', () => {
    expect(describeInvitationResponse({}, 500, 'Failed to accept invitation.')).toEqual({
      message: 'Failed to accept invitation.',
      seatLimit: false,
    })
  })
})
