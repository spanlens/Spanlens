'use client'
import { createContext, useContext, useState, type ReactNode } from 'react'

interface SidebarContextValue {
  isOpen: boolean
  toggle: () => void
  close: () => void
}

const SidebarContext = createContext<SidebarContextValue>({
  isOpen: false,
  toggle: () => {},
  close: () => {},
})

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  return (
    <SidebarContext.Provider
      value={{
        isOpen,
        toggle: () => setIsOpen((v) => !v),
        close: () => setIsOpen(false),
      }}
    >
      {children}
    </SidebarContext.Provider>
  )
}

export const useSidebar = () => useContext(SidebarContext)
