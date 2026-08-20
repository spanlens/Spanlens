/**
 * PT-1: shell skeleton for the dashboard layout.
 *
 * Shown as the Suspense fallback while the layout's prefetchAll(sidebarSpecs)
 * is running, so the browser sees the shell within ~50ms of the click instead
 * of waiting for 1-3s of server-side prefetch. The skeleton mirrors the
 * real Sidebar / main split so the swap to the real layout is visually
 * stable (no jump).
 *
 * Pure presentational, no client state — safe to render server-side.
 */
import { cn } from '@/lib/utils'

interface DashboardShellSkeletonProps {
  /** Mirrors the SidebarProvider's initial cookie-seeded collapse state so
   *  the skeleton matches the resolved Sidebar's geometry. Desktop only —
   *  the sidebar is a slide-in drawer on mobile and shows zero width by
   *  default there. */
  initialCollapsed: boolean
}

export function DashboardShellSkeleton({ initialCollapsed }: DashboardShellSkeletonProps) {
  return (
    <div className="flex h-screen overflow-hidden bg-bg">
      {/* Sidebar skeleton — desktop only. Mobile renders a closed drawer so
          there's nothing to skeletonise; the real Sidebar will mount with
          the topbar's menu button. Geometry tracks the real sidebar: 232px
          wide, band surface, 14px gutters, 16px top. */}
      <aside
        className={cn(
          'hidden md:flex flex-col shrink-0 border-r border-border bg-bg-muted',
          initialCollapsed ? 'w-0' : 'w-[232px]',
        )}
      >
        {!initialCollapsed && (
          <div className="flex-1 flex flex-col gap-3.5 px-[14px] pt-4 pb-[14px]">
            {/* Logo / workspace switcher row */}
            <div className="h-5 w-[100px] bg-bg-chip rounded-chip animate-pulse" />
            <div className="h-9 w-full bg-bg-chip rounded-md animate-pulse" />
            {/* Nav block — match the real sidebar's group of ~5 items */}
            <div className="space-y-1">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="h-8 w-full bg-bg-chip rounded animate-pulse opacity-80" />
              ))}
            </div>
            {/* Second group */}
            <div className="space-y-1">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-8 w-full bg-bg-chip rounded animate-pulse opacity-70" />
              ))}
            </div>
            {/* Bottom quota card */}
            <div className="mt-auto h-[62px] w-full bg-bg-chip rounded-lg animate-pulse" />
          </div>
        )}
      </aside>

      {/* Main area — keep empty/blank so the page's own loading.tsx
          skeleton owns the content space when it mounts. Even an empty
          main signals "page content is loading" to the user. */}
      <main className="flex-1 overflow-y-auto min-w-0" />
    </div>
  )
}
