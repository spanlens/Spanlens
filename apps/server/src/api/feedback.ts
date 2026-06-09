import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../middleware/authJwt.js'
import { supabaseAdmin, supabaseClient } from '../lib/db.js'
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
 * Public feature roadmap.
 *
 * Phase 1 (20260530120000_feedback.sql, original feedbackRouter) was submit-only:
 * client → server → ops email. No public list, no voting, no admin response surface.
 *
 * Phase 2 (R-32, this file + 20260609180000_feedback_phase2.sql) turns the
 * submission box into a public roadmap:
 *   GET    /                 — list submissions ranked by community vote (PUBLIC)
 *   POST   /                 — submit a suggestion (auth required)
 *   POST   /:id/vote         — upvote (auth required, idempotent)
 *   DELETE /:id/vote         — un-vote (auth required, idempotent)
 *
 * Admin response surface lives in apps/server/src/api/admin/feedback.ts.
 *
 * Auth model: GET is public so anonymous visitors can see the roadmap.
 * Write endpoints (POST/DELETE) attach authJwt per-route via Hono's
 * route-level middleware syntax. This used to be a router-wide
 * `feedbackRouter.use('*', authJwt)` but that 401'd anonymous list
 * requests, breaking the public-roadmap promise. PR #303 hotfix.
 */
export const feedbackRouter = new Hono<JwtContext>()

const VALID_CATEGORIES = new Set(['feature', 'bug', 'other'])
const VALID_STATUSES = new Set(['new', 'planned', 'in_progress', 'shipped', 'declined'])
const MAX_MESSAGE_LEN = 4000
const MIN_MESSAGE_LEN = 3

/** Hard cap on /feedback list page size. The public page paginates client-side
 *  so this is also the absolute upper bound a single response can carry. */
const LIST_LIMIT_DEFAULT = 50
const LIST_LIMIT_MAX = 200

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

/**
 * Optional userId resolution for the public GET handler.
 *
 * If the caller sent a Bearer token we validate it against Supabase Auth and
 * return the user id so `has_voted` can be populated per row. If the token is
 * missing or invalid we return null and serve the row list without per-user
 * vote state — anonymous visitors still see the roadmap.
 *
 * Why not authJwt: that middleware throws on a missing/invalid token. Here a
 * 401 would defeat the whole purpose of a public roadmap.
 */
async function resolveOptionalUserId(authHeader: string | undefined): Promise<string | null> {
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice(7).trim()
  if (!token) return null
  const { data, error } = await supabaseClient.auth.getUser(token)
  if (error || !data.user?.id) return null
  return data.user.id
}

// ── GET /api/v1/feedback — PUBLIC roadmap list ────────────────────────────────
//
// Query params:
//   ?status=new|planned|in_progress|shipped|declined   filter (default: all)
//   ?limit=N                                          1..LIST_LIMIT_MAX
//
// Sort: vote_count DESC, then created_at DESC (the supporting index is
// feedback_status_created_at_idx; vote_count sort happens in JS because
// PostgREST does not expose ORDER BY on a referenced relation aggregate).
//
// hasVoted per-row: derived from a single follow-up query keyed by the page's
// feedback ids, not a per-row N+1. Anonymous callers (no Bearer token) get
// has_voted=false for every row without the extra query.
feedbackRouter.get('/', async (c) => {
  const userId = await resolveOptionalUserId(c.req.header('Authorization'))

  const rawLimit = parseInt(c.req.query('limit') ?? '', 10)
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(rawLimit, LIST_LIMIT_MAX)
      : LIST_LIMIT_DEFAULT

  const statusFilter = c.req.query('status')
  if (statusFilter && !VALID_STATUSES.has(statusFilter)) {
    throw new ApiError('VALIDATION_FAILED', 'Invalid status filter', {
      allowed: Array.from(VALID_STATUSES),
    })
  }

  let query = supabaseAdmin
    .from('feedback')
    .select(
      'id, message, category, status, response_message, changelog_url, responded_at, created_at, feedback_votes(count)',
    )
    .order('created_at', { ascending: false })
    .limit(limit)

  if (statusFilter) {
    query = query.eq('status', statusFilter)
  }

  const { data, error } = await query
  if (error) {
    throw ApiError.from('INTERNAL_ERROR', { supabaseMessage: error.message })
  }

  type Row = {
    id: string
    message: string
    category: string
    status: string
    response_message: string | null
    changelog_url: string | null
    responded_at: string | null
    created_at: string
    feedback_votes: Array<{ count: number }> | null
  }

  const rows = (data ?? []) as Row[]
  const ids = rows.map((r) => r.id)

  // Single follow-up query for "did THIS user vote on these page rows".
  // Empty page or anonymous caller → skip the round-trip.
  let votedSet: Set<string> = new Set()
  if (ids.length > 0 && userId) {
    const { data: voted, error: votedError } = await supabaseAdmin
      .from('feedback_votes')
      .select('feedback_id')
      .eq('user_id', userId)
      .in('feedback_id', ids)
    if (votedError) {
      throw ApiError.from('INTERNAL_ERROR', { supabaseMessage: votedError.message })
    }
    votedSet = new Set((voted ?? []).map((v) => v.feedback_id))
  }

  const items = rows
    .map((r) => ({
      id: r.id,
      message: r.message,
      category: r.category,
      status: r.status,
      response_message: r.response_message,
      changelog_url: r.changelog_url,
      responded_at: r.responded_at,
      created_at: r.created_at,
      vote_count: r.feedback_votes?.[0]?.count ?? 0,
      has_voted: votedSet.has(r.id),
    }))
    // Secondary sort done in JS — PostgREST cannot ORDER BY on an aggregated
    // referenced relation. created_at DESC was already applied at SQL level
    // so equal-vote items keep their newest-first relative order from the
    // stable sort.
    .sort((a, b) => b.vote_count - a.vote_count)

  return c.json({ success: true, data: items })
})

// POST /api/v1/feedback — submit a suggestion. Auth required.
feedbackRouter.post('/', authJwt, async (c) => {
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

// ── POST /api/v1/feedback/:id/vote — idempotent upvote (auth required) ────────
//
// One vote per (user, feedback). Idempotency is enforced by the
// (feedback_id, user_id) UNIQUE constraint on feedback_votes; we INSERT
// unconditionally and treat a unique-violation as success. That keeps the
// happy path one round-trip (no SELECT-then-INSERT) and is race-safe under
// concurrent double-clicks.
feedbackRouter.post('/:id/vote', authJwt, async (c) => {
  const userId = c.get('userId')
  if (!userId) {
    // authJwt should have already rejected this; defensive throw keeps the
    // type narrow for the insert below.
    throw new ApiError('UNAUTHORIZED', 'Authentication required to vote')
  }

  const feedbackId = c.req.param('id')
  if (!feedbackId) {
    throw new ApiError('VALIDATION_FAILED', 'Missing feedback id')
  }

  // Confirm the feedback exists before touching feedback_votes so a vote
  // against a stale id returns 404 instead of a noisy FK violation 500.
  const { data: existing, error: existingError } = await supabaseAdmin
    .from('feedback')
    .select('id')
    .eq('id', feedbackId)
    .maybeSingle()
  if (existingError) {
    throw ApiError.from('INTERNAL_ERROR', { supabaseMessage: existingError.message })
  }
  if (!existing) {
    throw new ApiError('NOT_FOUND', 'Feedback not found')
  }

  const { error: insertError } = await supabaseAdmin
    .from('feedback_votes')
    .insert({ feedback_id: feedbackId, user_id: userId })

  // Postgres unique_violation = 23505. supabase-js surfaces this as
  // `code: '23505'`. Treat as success — the user already voted.
  if (insertError && insertError.code !== '23505') {
    throw ApiError.from('INTERNAL_ERROR', { supabaseMessage: insertError.message })
  }

  return c.json({ success: true })
})

// ── DELETE /api/v1/feedback/:id/vote — un-vote (auth required, also idempotent) ──
feedbackRouter.delete('/:id/vote', authJwt, async (c) => {
  const userId = c.get('userId')
  if (!userId) {
    throw new ApiError('UNAUTHORIZED', 'Authentication required to un-vote')
  }

  const feedbackId = c.req.param('id')
  if (!feedbackId) {
    throw new ApiError('VALIDATION_FAILED', 'Missing feedback id')
  }

  const { error } = await supabaseAdmin
    .from('feedback_votes')
    .delete()
    .eq('feedback_id', feedbackId)
    .eq('user_id', userId)
  // Note: deleting a non-existent row is a no-op success in PostgREST, so we
  // do not 404 here — repeat un-vote calls return success consistently.

  if (error) {
    throw ApiError.from('INTERNAL_ERROR', { supabaseMessage: error.message })
  }

  return c.json({ success: true })
})
