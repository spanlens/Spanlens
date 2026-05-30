'use client'
import {
  createContext,
  useCallback,
  useContext,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'

const COLLAPSE_STORAGE_KEY = 'sidebar-collapsed'

/* ── Desktop collapse: localStorage-backed external store ──
 *
 * The desktop hide/show preference lives in localStorage so it survives
 * reloads. We read it through useSyncExternalStore rather than a
 * useEffect+setState dance: that keeps SSR safe (getServerSnapshot returns the
 * default), avoids the react-hooks/set-state-in-effect lint rule, and gives
 * cross-tab sync for free via the `storage` event.
 */
function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_STORAGE_KEY) === '1'
  } catch {
    // localStorage can throw in private-mode / blocked-cookie contexts.
    return false
  }
}

const collapseListeners = new Set<() => void>()

function subscribeCollapsed(callback: () => void): () => void {
  collapseListeners.add(callback)
  window.addEventListener('storage', callback)
  return () => {
    collapseListeners.delete(callback)
    window.removeEventListener('storage', callback)
  }
}

function writeCollapsed(next: boolean): void {
  try {
    localStorage.setItem(COLLAPSE_STORAGE_KEY, next ? '1' : '0')
  } catch {
    // Ignore persistence failures — the in-memory snapshot still updates.
  }
  // `storage` events don't fire in the tab that made the change, so notify
  // this tab's subscribers explicitly.
  collapseListeners.forEach((l) => l())
}

interface SidebarContextValue {
  /** Mobile drawer open/closed. Desktop ignores this (sidebar is in-flow). */
  isOpen: boolean
  toggle: () => void
  close: () => void
  /**
   * Desktop hide/show. Independent from `isOpen` on purpose: the mobile
   * drawer and the desktop hide are two different behaviors, and mixing them
   * into one flag leads to "closed the drawer on mobile, sidebar vanished on
   * desktop" cross-talk. Persisted to localStorage. SSR + first paint default
   * to `false` (visible); a collapsed user sees a one-frame flash of the
   * sidebar before it hides, which we accept for simplicity.
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

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)

  // Server snapshot is always `false` (visible) — there's no localStorage on
  // the server. The client snapshot reads the stored value after hydration.
  const isCollapsed = useSyncExternalStore(subscribeCollapsed, readCollapsed, () => false)

  const toggleCollapsed = useCallback(() => {
    writeCollapsed(!readCollapsed())
  }, [])

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
