'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Returns a ref to attach to an element and whether it has ever come near the
 * viewport. Latches: once true it never goes back to false, because the point
 * is to trigger a one-time lazy import, not to unmount the chart when the user
 * scrolls past it.
 *
 * WHY THIS EXISTS:
 *
 * `next/dynamic(..., { ssr: false })` defers the module to a separate chunk,
 * but the chunk is fetched as soon as the wrapper *renders*. On /docs pages the
 * figures render on the initial pass even though they sit well below the fold,
 * so the recharts chunk was still starting at ~54 ms — before DOMContentLoaded
 * — despite being "lazy". Measured on production /docs/why: 136 KB starting at
 * 54 ms against a 658 ms DCL, with the figure off-screen.
 *
 * Gating the render on intersection is what actually defers the network work:
 * the `import()` inside the dynamic wrapper cannot fire until this hook flips,
 * because the wrapper is never rendered before then.
 *
 * HYDRATION SAFETY: the initial value is `false` on both the server pass and
 * the first client render, so the markup matches and the flip is an ordinary
 * post-mount update. Do NOT seed this from a measurement taken during render
 * (see CLAUDE.md gotcha #22 for the class of bug that creates).
 *
 * `rootMargin` starts the fetch a viewport-height early so the chart is usually
 * already painted by the time it scrolls into view — the goal is to move the
 * download off the critical path, not to make the user watch a placeholder.
 *
 * Falls open: if IntersectionObserver is unavailable (very old browsers, some
 * test environments) the effect renders the chart immediately rather than
 * leaving an empty box forever.
 */
export function useInViewport<T extends HTMLElement>(rootMargin = '200% 0px') {
  const ref = useRef<T>(null)
  const [inViewport, setInViewport] = useState(false)

  useEffect(() => {
    if (inViewport) return
    const el = ref.current
    if (!el) return

    if (typeof IntersectionObserver === 'undefined') {
      // Deliberately deferred to a frame rather than set inline: a synchronous
      // setState in an effect body trips react-hooks/set-state-in-effect and
      // causes a cascading render. The one-frame delay is irrelevant on the
      // only path that reaches here (a browser with no IntersectionObserver).
      const id = requestAnimationFrame(() => setInViewport(true))
      return () => cancelAnimationFrame(id)
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInViewport(true)
          observer.disconnect()
        }
      },
      { rootMargin },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [inViewport, rootMargin])

  return { ref, inViewport }
}
