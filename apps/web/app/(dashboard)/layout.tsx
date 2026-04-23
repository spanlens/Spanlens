import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { Sidebar } from '@/components/layout/sidebar'

/**
 * Dashboard layout. Reads auth state from the `x-spanlens-*` headers the
 * root middleware set after validating the session — no second `getUser()`
 * call here, which used to double the Supabase round-trip on every
 * dashboard navigation.
 *
 * If middleware ran and the user is authenticated, `x-spanlens-user-id` is
 * guaranteed present. Missing header + hitting /dashboard means middleware
 * didn't run for some reason (misconfig) OR we're in a dev-time edge case —
 * we fall back to a login redirect to fail safe.
 *
 * `x-spanlens-org-id` missing = authenticated user hasn't completed onboarding
 * (the onboarding page creates the org + sets app_metadata.org_id).
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const h = await headers()
  const userId = h.get('x-spanlens-user-id')
  const orgId = h.get('x-spanlens-org-id')

  if (!userId) redirect('/login')
  if (!orgId) redirect('/onboarding')

  return (
    <div className="flex h-screen overflow-hidden bg-bg">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="px-8 py-7">{children}</div>
      </main>
    </div>
  )
}
