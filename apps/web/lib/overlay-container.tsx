'use client'
import { createContext, useContext, useState, type ReactNode } from 'react'

/**
 * Portal target for dashboard overlays (dialogs, command palette).
 *
 * The dashboard renders at 125% via CSS `zoom` on its layout container, but
 * React portals (Radix dialogs) and inline command-palette overlays escape to
 * `document.body` / the providers above the zoom wrapper, so they'd render at
 * 100% while the rest of the UI is at 125%. To keep them consistent we render
 * a target node INSIDE the zoom wrapper and portal overlays into it, so they
 * inherit the same zoom scale.
 *
 * `useOverlayContainer()` returns null outside the dashboard (no provider), in
 * which case overlays fall back to their default body portal unchanged.
 */
const OverlayContainerContext = createContext<HTMLElement | null>(null)
const SetOverlayContainerContext = createContext<(el: HTMLElement | null) => void>(() => {})

export function useOverlayContainer(): HTMLElement | null {
  return useContext(OverlayContainerContext)
}

export function OverlayContainerProvider({ children }: { children: ReactNode }) {
  const [node, setNode] = useState<HTMLElement | null>(null)
  return (
    <SetOverlayContainerContext.Provider value={setNode}>
      <OverlayContainerContext.Provider value={node}>
        {children}
      </OverlayContainerContext.Provider>
    </SetOverlayContainerContext.Provider>
  )
}

/**
 * Renders the actual portal target node. Must be placed INSIDE the zoom
 * wrapper so portaled overlays inherit the dashboard zoom. The ref callback
 * registers the node into context; overlays read it via useOverlayContainer().
 */
export function OverlayContainerTarget() {
  const setNode = useContext(SetOverlayContainerContext)
  return <div ref={setNode} />
}
