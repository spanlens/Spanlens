'use client'
import { useSidebar } from '@/lib/sidebar-context'
import { cn } from '@/lib/utils'

/**
 * Content padding wrapper that reacts to the desktop sidebar collapse state.
 * When the sidebar is hidden, the floating "show sidebar" button sits at the
 * top-left of this area; without extra clearance it overlaps the page's own
 * header (e.g. the "Dashboard" breadcrumb). We add left padding on desktop
 * while collapsed so the button always has its own gutter. Mobile is
 * unaffected (the button is desktop-only).
 */
export function DashboardContent({ children }: { children: React.ReactNode }) {
  const { isCollapsed } = useSidebar()
  return (
    <div
      className={cn(
        'px-4 py-4 md:py-7 md:pr-8',
        isCollapsed ? 'md:pl-16' : 'md:pl-8',
      )}
    >
      {children}
    </div>
  )
}
