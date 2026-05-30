'use client'
import { createContext, useContext, useState, type ReactNode } from 'react'
import { writeSidebarCollapsedCookie } from '@/lib/sidebar-cookie'

interface SidebarContextValue {
  /** Mobile drawer open/closed. Desktop ignores this (sidebar is in-flow). */
  isOpen: boolean
  toggle: () => void
  close: () => void
  /**
   * Desktop hide/show. Independent from `isOpen` on purpose: the mobile
   * drawer and the desktop hide are two different behaviors, and mixing them
   * into one flag leads to "closed the drawer on mobile, sidebar vanished on
   * desktop" cross-talk.
   *
   * Seeded from a server-read cookie (`initialCollapsed`) so SSR renders the
   * correct state on first paint — no flash of the sidebar before the client
   * hydrates. Toggling updates the cookie so the next request stays in sync.
   */
  isCollapsed: boolean
  toggleCollapsed: () => void
}

const SidebarContext = createContext<SidebarContextValue>({
  isOpen: false,
  toggle: () => {},
  close: () => {},
  isCollapsed: false,
  toggleCollapsed: () => {},
})

export function SidebarProvider({
  children,
  initialCollapsed = false,
}: {
  children: ReactNode
  initialCollapsed?: boolean
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [isCollapsed, setIsCollapsed] = useState(initialCollapsed)

  function toggleCollapsed() {
    setIsCollapsed((v) => {
      const next = !v
      writeSidebarCollapsedCookie(next)
      return next
    })
  }

  return (
    <SidebarContext.Provider
      value={{
        isOpen,
        toggle: () => setIsOpen((v) => !v),
        close: () => setIsOpen(false),
        isCollapsed,
        toggleCollapsed,
      }}
    >
      {children}
    </SidebarContext.Provider>
  )
}

export const useSidebar = () => useContext(SidebarContext)
