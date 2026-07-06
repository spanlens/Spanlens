import { supabaseAdmin } from './db.js'

/**
 * Recipient resolver for the weekly usage digest (lib/weekly-digest.ts).
 *
 * Modeled on lib/admin-emails.ts getAdminEmails but keyed to the per-user
 * `weekly_digest_emails` preference instead of `security_alert_emails` —
 * the two switches are deliberately independent so opting out of a usage
 * summary never silences security alerts (and vice versa). Kept as a
 * separate module rather than a flag on getAdminEmails so that helper's
 * security-alert semantics stay untouched.
 *
 * Same defaults as the rest of user_notification_prefs: a user with no
 * prefs row is opted in; only an explicit `weekly_digest_emails = false`
 * row excludes them.
 */
export async function getWeeklyDigestRecipients(orgId: string): Promise<string[]> {
  const { data: members } = await supabaseAdmin
    .from('org_members')
    .select('user_id')
    .eq('organization_id', orgId)
    .eq('role', 'admin')

  const userIds = (members ?? []).map((m) => m.user_id)
  if (userIds.length === 0) return []

  const { data: optedOut } = await supabaseAdmin
    .from('user_notification_prefs')
    .select('user_id')
    .in('user_id', userIds)
    .eq('weekly_digest_emails', false)
  const optedOutSet = new Set((optedOut ?? []).map((r) => r.user_id as string))

  const emails: string[] = []
  for (const userId of userIds) {
    if (optedOutSet.has(userId)) continue
    const { data } = await supabaseAdmin.auth.admin.getUserById(userId)
    if (data?.user?.email) emails.push(data.user.email)
  }
  return emails
}
