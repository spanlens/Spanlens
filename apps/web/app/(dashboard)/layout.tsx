import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { Sidebar } from '@/components/layout/sidebar'
import { PendingInvitationsBanner } from '@/components/layout/pending-invitations-banner'
import { SidebarProvider } from '@/lib/sidebar-context'
import { CommandPaletteProvider } from '@/components/command-palette'

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
    <CommandPaletteProvider>
      <SidebarProvider>
        <div className="flex h-screen overflow-hidden bg-bg">
          <Sidebar />
          <main className="flex-1 overflow-y-auto min-w-0">
            {/* Pending workspace invitations surface here: any dashboard
                page renders this banner at the top, so a user who never
                clicked the email link still sees the invite waiting for
                them. Self-hides when there are none / after dismissal. */}
            <PendingInvitationsBanner />
            <div className="px-4 py-4 md:px-8 md:py-7">{children}</div>
          </main>
        </div>
      </SidebarProvider>
    </CommandPaletteProvider>
  )
}
