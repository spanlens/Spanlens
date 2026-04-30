import { supabaseAdmin } from './db.js'

/**
 * Resolve email addresses for all admin members of an org.
 * Falls back to empty array if no admins are found or no emails are set.
 *
 * Used by leak-detection.ts and stale-key-digest.ts (admin alerts).
 * Security alert emails use a separate owner-only lookup in logger.ts.
 */
export async function getAdminEmails(orgId: string): Promise<string[]> {
  const { data: members } = await supabaseAdmin
    .from('org_members')
    .select('user_id')
    .eq('organization_id', orgId)
    .eq('role', 'admin')

  const userIds = (members ?? []).map((m) => m.user_id)
  if (userIds.length === 0) return []

  const emails: string[] = []
  for (const userId of userIds) {
    const { data } = await supabaseAdmin.auth.admin.getUserById(userId)
    if (data?.user?.email) emails.push(data.user.email)
  }
  return emails
}
