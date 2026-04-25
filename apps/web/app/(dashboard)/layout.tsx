import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { Sidebar } from '@/components/layout/sidebar'
import { ProjectProvider } from '@/lib/project-context'

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
 * Two onboarding gates:
 *   • `x-spanlens-org-id` missing = bootstrap (workspace creation) hasn't run.
 *   • `x-spanlens-onboarded` missing = survey hasn't been completed/skipped.
 * Either case routes to /onboarding; the page handles both states (resumes
 * at the survey step if the workspace already exists).
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const h = await headers()
  const userId = h.get('x-spanlens-user-id')
  const orgId = h.get('x-spanlens-org-id')
  const onboarded = h.get('x-spanlens-onboarded') === '1'

  if (!userId) redirect('/login')
  if (!orgId || !onboarded) redirect('/onboarding')

  return (
    <ProjectProvider>
      <div className="flex h-screen overflow-hidden bg-bg">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          <div className="px-8 py-7">{children}</div>
        </main>
      </div>
    </ProjectProvider>
  )
}
