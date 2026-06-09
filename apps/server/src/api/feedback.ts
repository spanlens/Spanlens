import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../middleware/authJwt.js'
import { supabaseAdmin } from '../lib/db.js'
import { sendEmail } from '../lib/resend.js'
import { fireAndForget } from '../lib/wait-until.js'
import { ApiError } from '../lib/errors.js'

/** Spanlens internal operators (not org admins). Same allowlist env var as
 *  requireSystemAdmin. Returns [] when unset — the notification just no-ops. */
function getOpsEmails(): string[] {
  return (process.env['SPANLENS_ADMIN_EMAILS'] ?? '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean)
}

/**
 * Feature suggestion box. Phase 1 is submit-only (no public list, no voting):
 * a logged-in user sends a free-text suggestion from the dashboard, we persist
 * it and best-effort email the ops team so it lands on the roadmap radar.
 *
 * Auth: authJwt — only logged-in users. This is the spam defense (no anon
 * inserts), so there is intentionally no captcha/rate-limit beyond the global
 * /api/v1 rate limiter.
 */
export const feedbackRouter = new Hono<JwtContext>()

feedbackRouter.use('*', authJwt)

const VALID_CATEGORIES = new Set(['feature', 'bug', 'other'])
const MAX_MESSAGE_LEN = 4000
const MIN_MESSAGE_LEN = 3

interface FeedbackBody {
  message?: unknown
  category?: unknown
  source?: unknown
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// POST /api/v1/feedback — submit a suggestion.
feedbackRouter.post('/', async (c) => {
  const userId = c.get('userId')
  const orgId = c.get('orgId')
  const email = c.get('email')

  let body: FeedbackBody
  try {
    body = (await c.req.json()) as FeedbackBody
  } catch {
    throw new ApiError('INVALID_JSON_BODY', 'Invalid JSON body')
  }

  const message = typeof body.message === 'string' ? body.message.trim() : ''
  if (message.length < MIN_MESSAGE_LEN) {
    throw new ApiError('VALIDATION_FAILED', 'Message is too short')
  }
  if (message.length > MAX_MESSAGE_LEN) {
    throw new ApiError('VALIDATION_FAILED', `Message must be ${MAX_MESSAGE_LEN} characters or fewer`)
  }

  const category =
    typeof body.category === 'string' && VALID_CATEGORIES.has(body.category)
      ? body.category
      : 'feature'
  const source = typeof body.source === 'string' ? body.source.slice(0, 100) : 'dashboard'

  const { error } = await supabaseAdmin.from('feedback').insert({
    organization_id: orgId,
    user_id: userId,
    email: email ?? null,
    category,
    message,
    source,
  })

  if (error) {
    console.error('[feedback] insert failed:', error.message)
    throw new ApiError('INTERNAL_ERROR', 'Failed to submit feedback')
  }

  // Best-effort ops notification. fireAndForget so the response isn't blocked
  // on Resend latency, and the promise is drained on Vercel (gotcha #8).
  // No-ops when SPANLENS_ADMIN_EMAILS / RESEND_API_KEY are unset (dev).
  const opsEmails = getOpsEmails()
  if (opsEmails.length > 0) {
    const html =
      `<p><strong>Category:</strong> ${escapeHtml(category)}</p>` +
      `<p><strong>From:</strong> ${escapeHtml(email ?? 'unknown')} (org ${escapeHtml(orgId ?? 'none')})</p>` +
      `<p><strong>Source:</strong> ${escapeHtml(source)}</p>` +
      `<hr/><p style="white-space:pre-wrap">${escapeHtml(message)}</p>`
    fireAndForget(
      c,
      Promise.all(
        opsEmails.map((to) =>
          sendEmail({
            to,
            subject: `New ${category} feedback from ${email ?? 'a user'}`,
            html,
          }),
        ),
      ),
    )
  }

  return c.json({ success: true })
})
