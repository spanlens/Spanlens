import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Sidebar } from '@/components/layout/sidebar'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  // Check org membership via JWT claim — zero network calls.
  // POST /api/v1/organizations sets app_metadata.org_id; the onboarding page
  // calls supabase.auth.refreshSession() afterwards so the cookie carries
  // the latest claims by the time the user lands on a dashboard route.
  const orgId = (user.app_metadata as { org_id?: string } | undefined)?.org_id
  if (!orgId) redirect('/onboarding')

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto bg-gray-50">
        <div className="max-w-7xl mx-auto px-6 py-8">{children}</div>
      </main>
    </div>
  )
}
