import { describe, expect, test, vi } from 'vitest'

vi.mock('./db.js', async () => {
  const { recorder } = await import('../__tests__/helpers/supabase-recorder.js')
  return { supabaseAdmin: recorder.client, supabaseClient: recorder.client }
})

import { recorder } from '../__tests__/helpers/supabase-recorder.js'
import { SEAT_LIMITS } from './quota.js'
import {
  getOrgSeatPolicy,
  seatLimitError,
  seatLimitFor,
  seatLimitsEnforced,
} from './org-seats.js'

describe('seatLimitsEnforced', () => {
  test('hosted instances (Paddle configured) enforce by default', () => {
    expect(seatLimitsEnforced({ PADDLE_API_KEY: 'pdl_live_x' })).toBe(true)
  })

  test('self-hosted instances without billing do not, so a team is never stuck at one seat', () => {
    expect(seatLimitsEnforced({})).toBe(false)
    expect(seatLimitsEnforced({ PADDLE_API_KEY: '' })).toBe(false)
  })

  test('the explicit flag wins in both directions', () => {
    expect(seatLimitsEnforced({ SPANLENS_ENFORCE_SEAT_LIMITS: 'true' })).toBe(true)
    expect(
      seatLimitsEnforced({ SPANLENS_ENFORCE_SEAT_LIMITS: 'false', PADDLE_API_KEY: 'pdl_live_x' }),
    ).toBe(false)
    expect(seatLimitsEnforced({ SPANLENS_ENFORCE_SEAT_LIMITS: ' TRUE ' })).toBe(true)
  })
})

describe('seatLimitFor', () => {
  const on = { SPANLENS_ENFORCE_SEAT_LIMITS: 'true' }

  test('reads SEAT_LIMITS, the single source of truth', () => {
    expect(seatLimitFor('free', on)).toBe(SEAT_LIMITS.free)
    expect(seatLimitFor('starter', on)).toBe(3)
    expect(seatLimitFor('team', on)).toBe(10)
    expect(seatLimitFor('enterprise', on)).toBeNull()
  })

  test('is unlimited when enforcement is off', () => {
    expect(seatLimitFor('free', {})).toBeNull()
  })
})

describe('getOrgSeatPolicy', () => {
  test('does not read the plan when enforcement is off', async () => {
    recorder.reset()
    const policy = await getOrgSeatPolicy('org-1', {})
    expect(policy).toEqual({ plan: null, limit: null })
    expect(recorder.queries).toHaveLength(0)
  })

  test('an unknown plan value falls back to the Free allowance', async () => {
    recorder.reset()
    recorder.queue('organizations', { data: { plan: 'legacy' }, error: null })
    const policy = await getOrgSeatPolicy('org-1', { SPANLENS_ENFORCE_SEAT_LIMITS: 'true' })
    expect(policy).toEqual({ plan: 'free', limit: 1 })
  })

  test('a failed plan lookup throws instead of guessing', async () => {
    recorder.reset()
    recorder.queue('organizations', { data: null, error: { message: 'timeout' } })
    await expect(
      getOrgSeatPolicy('org-1', { SPANLENS_ENFORCE_SEAT_LIMITS: 'true' }),
    ).rejects.toMatchObject({ code: 'INTERNAL_ERROR' })
  })

  test('a missing org throws NOT_FOUND', async () => {
    recorder.reset()
    recorder.queue('organizations', { data: null, error: null })
    await expect(
      getOrgSeatPolicy('org-1', { SPANLENS_ENFORCE_SEAT_LIMITS: 'true' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('seatLimitError', () => {
  test('admin copy names the plan and the way out, without em dashes', () => {
    const err = seatLimitError({ plan: 'starter', limit: 3 }, 3, 'admin')
    expect(err.code).toBe('PAYMENT_REQUIRED')
    expect(err.status).toBe(402)
    expect(err.details).toMatchObject({ reason: 'seat_limit_reached', plan: 'starter', limit: 3, used: 3 })
    expect(err.message).toContain('Pro plan includes 3 seats')
    expect(err.message).not.toContain('—')
  })

  test('invitee copy points at the workspace admin', () => {
    const err = seatLimitError({ plan: 'free', limit: 1 }, 1, 'invitee')
    expect(err.message).toContain('every seat on its Free plan (1 seat)')
    expect(err.message).toContain('Ask a workspace admin')
    expect(err.message).not.toContain('—')
  })
})
