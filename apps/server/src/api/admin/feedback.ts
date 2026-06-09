import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../../middleware/authJwt.js'
import { requireSystemAdmin } from '../../middleware/requireSystemAdmin.js'
import { supabaseAdmin } from '../../lib/db.js'
import { ApiError } from '../../lib/errors.js'

/**
 * Admin-only feedback response surface (R-32 Phase B).
 *
 *   PATCH /api/v1/admin/feedback/:id   update status / response / changelog
 *
 * Authorization: SPANLENS_ADMIN_EMAILS env var (see requireSystemAdmin).
 *
 * The public feedback router (apps/server/src/api/feedback.ts) handles
 * submissions and voting; this router is the admin-side write surface for
 * the lifecycle (new -> planned -> in_progress -> shipped/declined) and the
 * public response message that shows under each submission.
 *
 * Mounted under `/api/v1/admin/feedback` AFTER the `/api/v1/feedback` route
 * so the wildcard inside feedbackRouter does not shadow it. (`/api/v1/admin/*`
 * does not collide because the prefix is more specific.)
 */
export const adminFeedbackRouter = new Hono<JwtContext>()

adminFeedbackRouter.use('*', authJwt)
adminFeedbackRouter.use('*', requireSystemAdmin)

const VALID_STATUSES = new Set(['new', 'planned', 'in_progress', 'shipped', 'declined'])

/** Hard cap on response/changelog field lengths. Mirrors the public
 *  feedback message cap so admin replies cannot blow up the row. */
const MAX_RESPONSE_LEN = 4000
const MAX_CHANGELOG_URL_LEN = 500

interface PatchBody {
  status?: unknown
  response_message?: unknown
  changelog_url?: unknown
}

interface FeedbackUpdate {
  status?: string
  response_message?: string | null
  changelog_url?: string | null
  responded_at?: string | null
  responded_by?: string | null
}

adminFeedbackRouter.patch('/:id', async (c) => {
  const id = c.req.param('id')
  if (!id) {
    throw new ApiError('VALIDATION_FAILED', 'Missing feedback id')
  }

  const adminUserId = c.get('userId')

  let body: PatchBody
  try {
    body = (await c.req.json()) as PatchBody
  } catch {
    throw new ApiError('INVALID_JSON_BODY', 'Invalid JSON body')
  }

  const update: FeedbackUpdate = {}

  if (body.status !== undefined) {
    if (typeof body.status !== 'string' || !VALID_STATUSES.has(body.status)) {
      throw new ApiError('VALIDATION_FAILED', 'Invalid status', {
        allowed: Array.from(VALID_STATUSES),
      })
    }
    update.status = body.status
  }

  if (body.response_message !== undefined) {
    if (body.response_message === null) {
      // Allow clearing a previously posted response.
      update.response_message = null
      update.responded_at = null
      update.responded_by = null
    } else if (typeof body.response_message === 'string') {
      const trimmed = body.response_message.trim()
      if (trimmed.length === 0) {
        throw new ApiError('VALIDATION_FAILED', 'response_message cannot be empty; pass null to clear')
      }
      if (trimmed.length > MAX_RESPONSE_LEN) {
        throw new ApiError(
          'VALIDATION_FAILED',
          `response_message must be ${MAX_RESPONSE_LEN} characters or fewer`,
        )
      }
      update.response_message = trimmed
      update.responded_at = new Date().toISOString()
      update.responded_by = adminUserId ?? null
    } else {
      throw new ApiError('VALIDATION_FAILED', 'response_message must be a string or null')
    }
  }

  if (body.changelog_url !== undefined) {
    if (body.changelog_url === null) {
      update.changelog_url = null
    } else if (typeof body.changelog_url === 'string') {
      const trimmed = body.changelog_url.trim()
      if (trimmed.length === 0) {
        update.changelog_url = null
      } else {
        if (trimmed.length > MAX_CHANGELOG_URL_LEN) {
          throw new ApiError(
            'VALIDATION_FAILED',
            `changelog_url must be ${MAX_CHANGELOG_URL_LEN} characters or fewer`,
          )
        }
        // Minimal URL sanity check — the column is text not URI in the DB so
        // we keep this loose, just reject obvious garbage.
        if (!/^https?:\/\//i.test(trimmed)) {
          throw new ApiError('VALIDATION_FAILED', 'changelog_url must be an http(s) URL')
        }
        update.changelog_url = trimmed
      }
    } else {
      throw new ApiError('VALIDATION_FAILED', 'changelog_url must be a string or null')
    }
  }

  if (Object.keys(update).length === 0) {
    throw new ApiError('VALIDATION_FAILED', 'No updatable fields supplied')
  }

  const { data, error } = await supabaseAdmin
    .from('feedback')
    .update(update)
    .eq('id', id)
    .select('id, status, response_message, changelog_url, responded_at, responded_by')
    .maybeSingle()

  if (error) {
    throw ApiError.from('INTERNAL_ERROR', { supabaseMessage: error.message })
  }
  if (!data) {
    throw new ApiError('NOT_FOUND', 'Feedback not found')
  }

  return c.json({ success: true, data })
})
