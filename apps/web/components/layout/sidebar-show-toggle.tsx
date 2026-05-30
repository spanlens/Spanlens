'use client'
import { PanelLeft } from 'lucide-react'
import { useSidebar } from '@/lib/sidebar-context'

/**
 * Floating "show sidebar" control. When the desktop sidebar is collapsed to
 * zero width there's no in-sidebar button left to bring it back, so we surface
 * this small fixed button at the top-left of the content area. Desktop-only
 * (md:): mobile uses the drawer + its own X, and never sets `isCollapsed`.
 */
export function SidebarShowToggle() {
  const { isCollapsed, toggleCollapsed } = useSidebar()

  if (!isCollapsed) return null

  return (
    <button
      type="button"
      onClick={toggleCollapsed}
      aria-label="Show sidebar"
      title="Show sidebar"
      className="hidden md:inline-flex fixed left-3 top-3 z-30 items-center justify-center p-1.5 rounded-[6px] border border-border bg-bg-elev text-text-faint shadow-sm hover:text-text hover:bg-bg-muted transition-colors"
    >
      <PanelLeft size={16} />
    </button>
  )
}
