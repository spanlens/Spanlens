import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../middleware/authJwt.js'
import { supabaseAdmin } from '../lib/db.js'

/**
 * /api/v1/me/profile — onboarding survey + completion flag.
 *
 *   GET   /me/profile                — current user's profile (or null)
 *   POST  /me/profile/complete       — finalize onboarding
 *
 * The dashboard layout looks at `onboarded_at` to decide whether to show
 * the app or redirect to /onboarding. The survey itself is OPTIONAL — the
 * complete endpoint accepts a body with `use_case` and `role` but treats
 * any missing/blank values as "skipped" rather than rejecting the call.
 */

export const userProfilesRouter = new Hono<JwtContext>()

userProfilesRouter.use('*', authJwt)

// Allowlist for the survey enums. Mirrors the radio options shown on the
// /onboarding page. Free-text "other" is accepted as the literal string
// "other" — we don't want a write-in field at this stage to keep the
// signal:noise ratio high. Add new options here AND on the page.
const USE_CASES = ['chatbot', 'rag', 'agent', 'code_assistant', 'internal_tool', 'other'] as const
const ROLES = ['engineer', 'product', 'founder', 'researcher', 'other'] as const

type UseCase = (typeof USE_CASES)[number]
type Role = (typeof ROLES)[number]

function normaliseEnum<T extends string>(allowed: readonly T[], value: unknown): T | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().toLowerCase()
  return (allowed as readonly string[]).includes(trimmed) ? (trimmed as T) : null
}

userProfilesRouter.get('/', async (c) => {
  const userId = c.get('userId')

  const { data, error } = await supabaseAdmin
    .from('user_profiles')
    .select('user_id, use_case, role, onboarded_at, created_at, updated_at')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) return c.json({ error: 'Failed to fetch profile' }, 500)
  return c.json({ success: true, data: data ?? null })
})

userProfilesRouter.post('/complete', async (c) => {
  const userId = c.get('userId')

  let body: { use_case?: unknown; role?: unknown }
  try {
    body = (await c.req.json().catch(() => ({}))) as typeof body
  } catch {
    body = {}
  }

  const useCase: UseCase | null = normaliseEnum(USE_CASES, body.use_case)
  const role: Role | null = normaliseEnum(ROLES, body.role)
  const now = new Date().toISOString()

  // Upsert — survives the rare retry where the client posts twice.
  // Re-completing keeps the original onboarded_at (COALESCE on the SET clause)
  // so analytics keep the original first-completion timestamp.
  const { data, error } = await supabaseAdmin
    .from('user_profiles')
    .upsert(
      {
        user_id: userId,
        use_case: useCase,
        role: role,
        onboarded_at: now,
      },
      { onConflict: 'user_id' },
    )
    .select('user_id, use_case, role, onboarded_at')
    .single()

  if (error || !data) return c.json({ error: 'Failed to save profile' }, 500)
  return c.json({ success: true, data }, 201)
})
