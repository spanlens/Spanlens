import { AdminFeedbackClient } from './admin-feedback-client'

/**
 * R-32 Phase D — internal admin surface for the public roadmap.
 *
 * Authorization: enforced server-side by `requireSystemAdmin` (SPANLENS_ADMIN_EMAILS).
 * The page does not gate itself client-side; non-admins see "Forbidden" toasts when
 * they attempt to PATCH. This keeps the page testable in production with a real
 * admin email and avoids leaking the allowlist to the browser.
 *
 * Sidebar does NOT link here on purpose — the URL is admin-only and known to
 * the small Spanlens operator group; surfacing it to all logged-in users would
 * just produce 403 toasts.
 */
export const metadata = {
  title: 'Admin · Feedback · Spanlens',
  robots: { index: false, follow: false },
}

export default function AdminFeedbackPage() {
  return <AdminFeedbackClient />
}
