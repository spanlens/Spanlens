'use client'

import { useEffect, useRef } from 'react'

/**
 * Reveals its children once they scroll into view.
 *
 * The children are passed in from a server component and are never inspected
 * or cloned, so the sections stay server-rendered and the page stays
 * statically prerenderable. All this adds to the client bundle is one observer.
 *
 * The state machine is deliberately three-legged:
 *
 *   (no attribute) → server render and every non-JS path. Fully visible.
 *   ready          → mounted, observer attached. Children are hidden.
 *   shown          → intersected once. Children animate in and stay.
 *
 * Hidden is therefore only ever reachable from code that has already proven it
 * can run, which is what stops a failed hydration, a blocked bundle or a
 * crawler from seeing an empty page. `ready` is entered from the observer's
 * own first callback, so even a document where the observer silently does
 * nothing never reaches it.
 *
 * The stage is written straight onto the DOM node rather than held in React
 * state. It drives nothing but a CSS selector, so a re-render would buy
 * nothing, and setting state synchronously in an effect is exactly the
 * cascading-render pattern `react-hooks/set-state-in-effect` exists to stop.
 *
 * See `app/globals.css` for the animation each `kind` plays.
 */
interface RevealProps {
  children: React.ReactNode
  className?: string
  /**
   * Which entry the children play. `rise` (default) fades them up, `bars`
   * grows them from a bottom baseline, `waterfall` fades each row in and wipes
   * its `[data-sl-bar]` along the track.
   */
  kind?: 'rise' | 'bars' | 'waterfall'
  /** Milliseconds between successive children. */
  stagger?: number
  /** How much of the element must be visible before it plays. */
  threshold?: number
}

export function Reveal({
  children,
  className,
  kind = 'rise',
  stagger,
  threshold = 0.15,
}: RevealProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    // Honour the OS setting by never hiding anything in the first place. The
    // stylesheet also neutralises the animations, but leaving the attribute
    // off means there is nothing to neutralise.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    // An element already on screen at mount (anything above the fold, or a
    // deep link that lands mid-page) should not flash hidden and animate back
    // in, so it goes straight to `shown` without passing through `ready`.
    const rect = el.getBoundingClientRect()
    if (rect.top < window.innerHeight && rect.bottom > 0) {
      el.dataset.reveal = 'shown'
      return
    }

    // No IntersectionObserver (old browser, or a test environment that stubs
    // it away): leave the children visible rather than hiding them forever.
    if (typeof IntersectionObserver === 'undefined') return

    /*
     * Hiding is deferred to the observer's first callback rather than done
     * here, which is what makes "never hide what we cannot un-hide" hold
     * without a timer racing the reader.
     *
     * The spec has the observer deliver an initial entry for everything it is
     * given, so that first callback is proof the observer works in this
     * document. Only then is it safe to hide. A plain timeout was the earlier
     * approach and was worse in both directions: too short and it revealed
     * sections the reader had not reached yet, so the animation was over
     * before they scrolled to it; too long and a broken observer left the page
     * blank for that whole window.
     */
    /*
     * The root is expanded upwards by an absurd amount on purpose, which turns
     * "is this on screen" into "has this reached the trigger line, or gone
     * past it". Both readings reveal the section, and only the second one
     * survives a jump.
     *
     * With an ordinary root, a reader who lands past a section — an anchor
     * link, End, a restored scroll position — leaves it hidden forever. The
     * observer samples once per frame and only reports threshold crossings, so
     * a section that goes from below the viewport to above it in a single jump
     * has a ratio of 0 both times, crosses nothing, and never gets a callback
     * at all. Testing `boundingClientRect.bottom` inside the callback does not
     * help, because the callback is what never runs.
     */
    let armed = false
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            el.dataset.reveal = 'shown'
            observer.disconnect()
            return
          }
          if (!armed) {
            armed = true
            el.dataset.reveal = 'ready'
          }
        }
      },
      { threshold, rootMargin: '999999px 0px -8% 0px' },
    )
    observer.observe(el)

    return () => observer.disconnect()
  }, [threshold])

  return (
    <div
      ref={ref}
      className={className}
      {...(kind === 'rise' ? {} : { 'data-reveal-kind': kind })}
      {...(stagger === undefined ? {} : { style: { ['--sl-step' as string]: `${stagger}ms` } })}
    >
      {children}
    </div>
  )
}
