'use client'

import { useEffect, useState } from 'react'

/**
 * Visual feedback during workspace switches.
 *
 * The sidebar switcher fires a `spanlens:workspace-switching` CustomEvent
 * just before `window.location.href = '/dashboard'`. This component listens
 * for that event and renders a top progress bar plus a faint dim layer over
 * the page. The browser keeps showing the old DOM until the new HTML is
 * ready, so the user sees these markers for the entire ~800ms-1.5s round
 * trip instead of staring at an unchanged page that "feels frozen".
 *
 * After hard reload completes, this component re-mounts fresh in the new
 * page with `isSwitching=false`, so the overlay goes away automatically.
 * No cleanup logic needed.
 */
export function WorkspaceSwitchOverlay() {
  const [isSwitching, setIsSwitching] = useState(false)

  useEffect(() => {
    function handler() {
      setIsSwitching(true)
    }
    window.addEventListener('spanlens:workspace-switching', handler)
    return () => window.removeEventListener('spanlens:workspace-switching', handler)
  }, [])

  if (!isSwitching) return null

  return (
    <>
      {/* Top progress bar. Pure CSS animation, no JS tick. */}
      <div
        aria-hidden
        className="fixed top-0 left-0 right-0 h-[2px] z-[9999] overflow-hidden pointer-events-none"
      >
        <div className="spanlens-progress-bar h-full w-full bg-accent" />
      </div>

      {/* Dim layer over the page content. Pointer-events disabled so the
          old DOM stays interactive in case the user clicks during transition
          (though typically there is nothing to click). */}
      <div
        aria-hidden
        className="fixed inset-0 z-[9998] bg-bg/40 backdrop-blur-[1px] pointer-events-none transition-opacity duration-150"
      />
    </>
  )
}
