import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/db.js'
import { sendEmail, renderWaitlistConfirmationEmail } from '../lib/resend.js'
import { fireAndForget } from '../lib/wait-until.js'
import { ApiError } from '../lib/errors.js'

/**
 * Public waitlist — no auth required.
 *
 * POST /api/v1/waitlist   { email, name?, company?, use_case? }
 *   → 201 on first sign-up, 200 on duplicate (idempotent, safe to re-submit)
 *
 * GET  /api/v1/waitlist   admin-only (requires internal secret header)
 *   → list of all waitlist entries, newest first
 */

export const waitlistRouter = new Hono()

waitlistRouter.post('/', async (c) => {
  let body: Record<string, unknown>
  try {
    body = await c.req.json() as Record<string, unknown>
  } catch {
    throw new ApiError('INVALID_JSON_BODY', 'Invalid JSON body')
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : null
  if (!email || !email.includes('@')) {
    throw new ApiError('VALIDATION_FAILED', 'A valid email is required')
  }

  const name    = typeof body.name     === 'string' ? body.name.trim()     : null
  const company = typeof body.company  === 'string' ? body.company.trim()  : null
  const useCase = typeof body.use_case === 'string' ? body.use_case.trim() : null

  // Idempotent: duplicate email returns 200 (not 409)
  const { data: existing } = await supabaseAdmin
    .from('waitlist')
    .select('id, status')
    .eq('email', email)
    .maybeSingle()

  if (existing) {
    return c.json({ success: true, alreadyRegistered: true, status: existing.status }, 200)
  }

  const { error } = await supabaseAdmin
    .from('waitlist')
    .insert({ email, name, company, use_case: useCase })

  if (error) {
    console.error('waitlist insert error:', error.message)
    throw new ApiError('INTERNAL_ERROR', 'Failed to join waitlist')
  }

  // Fire-and-forget confirmation email — don't block the response
  const { subject, html } = renderWaitlistConfirmationEmail()
  fireAndForget(c, sendEmail({ to: email, subject, html }))

  return c.json({ success: true, alreadyRegistered: false }, 201)
})

// Admin list endpoint — protected by a simple bearer secret so it can be
// called from cURL / Retool without requiring a full JWT flow.
waitlistRouter.get('/', async (c) => {
  const cronSecret = process.env.CRON_SECRET
  const auth = c.req.header('Authorization') ?? ''
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    throw new ApiError('UNAUTHORIZED', 'Unauthorized')
  }

  const { data, error } = await supabaseAdmin
    .from('waitlist')
    .select('id, email, name, company, use_case, status, created_at')
    .order('created_at', { ascending: false })

  if (error) throw new ApiError('INTERNAL_ERROR', 'Failed to fetch waitlist')

  return c.json({ success: true, data, total: data?.length ?? 0 })
})
