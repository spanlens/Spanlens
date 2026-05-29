import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../middleware/authJwt.js'
import { supabaseAdmin } from '../lib/db.js'

/**
 * /api/v1/me/notification-prefs — per-USER email notification preferences.
 *
 *   GET   /me/notification-prefs   — current user's prefs (defaults if unset)
 *   PATCH /me/notification-prefs   — update one or more toggles
 *
 * Account-level, distinct from org-level notification_channels (which decide
 * WHERE alerts go). These decide what email reaches THIS person. See the
 * 20260529000100_user_notification_prefs migration for the boundary writeup.
 *
 * Defaults are all `true` so a user with no row yet is treated as opted in —
 * matching the emails they already receive before this feature shipped.
 */

export const userNotificationPrefsRouter = new Hono<JwtContext>()

userNotificationPrefsRouter.use('*', authJwt)

interface NotificationPrefs {
  security_alert_emails: boolean
  marketing_emails: boolean
  product_update_emails: boolean
}

const DEFAULT_PREFS: NotificationPrefs = {
  security_alert_emails: true,
  marketing_emails: true,
  product_update_emails: true,
}

const PREF_KEYS = Object.keys(DEFAULT_PREFS) as (keyof NotificationPrefs)[]

userNotificationPrefsRouter.get('/', async (c) => {
  const userId = c.get('userId')

  const { data, error } = await supabaseAdmin
    .from('user_notification_prefs')
    .select('security_alert_emails, marketing_emails, product_update_emails')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) return c.json({ error: 'Failed to fetch notification preferences' }, 500)
  return c.json({ success: true, data: { ...DEFAULT_PREFS, ...(data ?? {}) } })
})

userNotificationPrefsRouter.patch('/', async (c) => {
  const userId = c.get('userId')

  let body: Partial<Record<keyof NotificationPrefs, unknown>>
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  // Pick only known boolean keys — ignore anything else the client sends.
  const updates: Partial<NotificationPrefs> = {}
  for (const key of PREF_KEYS) {
    const value = body[key]
    if (typeof value === 'boolean') updates[key] = value
  }
  if (Object.keys(updates).length === 0) {
    return c.json({ error: 'No valid preference fields provided' }, 400)
  }

  const { data, error } = await supabaseAdmin
    .from('user_notification_prefs')
    .upsert({ user_id: userId, ...updates }, { onConflict: 'user_id' })
    .select('security_alert_emails, marketing_emails, product_update_emails')
    .single()

  if (error || !data) return c.json({ error: 'Failed to save notification preferences' }, 500)
  return c.json({ success: true, data: { ...DEFAULT_PREFS, ...data } })
})
