'use client'

import { useEffect, useRef, useState } from 'react'
import { ProviderMark, type ProviderId } from '@/components/landing/provider-marks'

/**
 * The ten supported providers on an arc, five visible at a time.
 *
 * The centre slot is the focused provider and carries the caption; the four
 * flanking tiles are smaller and tilted away from centre. Selecting any tile
 * or pager dot rotates that slot into the middle, so the whole roster is
 * reachable without a horizontal scroller.
 */

interface Provider {
  id: ProviderId
  name: string
  /** What the proxy actually forwards for this provider. */
  detail: string
}

// Typed as a non-empty tuple so the wrap-around lookup below has a element to
// fall back on that the compiler can see is always defined.
const PROVIDERS: [Provider, ...Provider[]] = [
  { id: 'openai', name: 'OpenAI', detail: 'chat, responses and embeddings, streaming included' },
  {
    id: 'anthropic',
    name: 'Anthropic',
    detail: 'messages and tool use, with usage read off message_delta',
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    detail: 'generateContent and streaming, reasoning tokens counted',
  },
  {
    id: 'azure',
    name: 'Azure OpenAI',
    detail: 'your deployment names, priced against the OpenAI table',
  },
  { id: 'mistral', name: 'Mistral', detail: 'chat completions and streaming over the native API' },
  { id: 'groq', name: 'Groq', detail: 'the OpenAI-compatible surface at Groq latencies' },
  { id: 'xai', name: 'xAI', detail: 'Grok chat completions, streaming included' },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    detail: 'chat and reasoner, with reasoning tokens attributed',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    detail: 'every model behind one key, priced per upstream route',
  },
  { id: 'cohere', name: 'Cohere', detail: 'chat and embeddings over the native API' },
]

/**
 * Arc geometry by distance from the centre slot.
 *
 * Every provider owns a tile for the life of the component and slides between
 * these positions, rather than the five slots keeping their place and swapping
 * contents. That distinction is the whole point: swapping contents can only
 * ever crossfade, while moving the tile reads as the roster turning.
 *
 * `pos` is a CSS variable so the step can shrink on a phone without the
 * component knowing the breakpoint; the container declares the values.
 * `scale` gives the centre tile its 128px face off the 104px base (128/104),
 * which also scales the mark inside it by exactly the ratio the comp uses.
 */
const RING: { pos: string; drop: number; tilt: number; scale: number }[] = [
  { pos: '0px', drop: 0, tilt: 0, scale: 128 / 104 },
  { pos: 'var(--arc-p1)', drop: 38, tilt: 9, scale: 1 },
  { pos: 'var(--arc-p2)', drop: 64, tilt: 18, scale: 1 },
  { pos: 'var(--arc-p3)', drop: 88, tilt: 26, scale: 1 },
]

/** Wraps any index, positive or negative, into the roster. */
function providerAt(index: number): Provider {
  const wrapped = ((index % PROVIDERS.length) + PROVIDERS.length) % PROVIDERS.length
  return PROVIDERS[wrapped] ?? PROVIDERS[0]
}

/**
 * Shortest signed distance from the focused index to `index`, so a tile always
 * travels the short way round the ring instead of unwinding across the arc.
 * Range is -5..4 for a ten-provider roster.
 */
function ringOffset(index: number, focused: number): number {
  const half = Math.floor(PROVIDERS.length / 2)
  return (((index - focused + half) % PROVIDERS.length) + PROVIDERS.length) % PROVIDERS.length - half
}

/** How long each provider holds the centre slot before the arc advances. */
const AUTO_ADVANCE_MS = 3600

export function IntegrationsArc() {
  const [focused, setFocused] = useState(0)
  const active = providerAt(focused)

  const sectionRef = useRef<HTMLElement>(null)
  /**
   * The arc rotates itself until the reader takes over. Picking a tile or a
   * dot is a statement of intent, so the rotation stops for good rather than
   * yanking their choice away a few seconds later; hovering only pauses it.
   */
  const [taken, setTaken] = useState(false)
  const [paused, setPaused] = useState(false)
  // Starts true so a browser without IntersectionObserver still rotates; the
  // observer only ever narrows it. Initialising to false and correcting in the
  // effect would mean a synchronous setState in an effect body.
  const [onScreen, setOnScreen] = useState(true)

  function choose(next: number) {
    setTaken(true)
    setFocused(next)
  }

  // Only run while the arc is actually on screen. Off-screen the interval
  // would spin the roster past several providers for nobody to see, and land
  // the reader somewhere arbitrary when they finally scroll down.
  useEffect(() => {
    const el = sectionRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setOnScreen(entry.isIntersecting)
      },
      { threshold: 0.3 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (taken || paused || !onScreen) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const id = window.setInterval(() => {
      // A background tab still fires intervals in some browsers; advancing
      // there just burns work and desynchronises the caption from the arc.
      if (document.hidden) return
      setFocused((f) => f + 1)
    }, AUTO_ADVANCE_MS)
    return () => window.clearInterval(id)
  }, [taken, paused, onScreen])

  return (
    <section
      ref={sectionRef}
      className="px-4 py-16 sm:px-6 lg:px-10 lg:py-[110px]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <div className="mx-auto max-w-[1200px]">
        <header className="mx-auto max-w-[820px] text-center">
          <h2 className="font-display track-h2 text-[30px] leading-[1.08] text-text lg:text-[52px]">
            Keep the SDK you already import
          </h2>
          <p className="mx-auto mt-4 max-w-[580px] text-[14.5px] leading-[1.6] text-text-muted lg:text-[16.5px]">
            The proxy speaks each provider natively, so streaming, tools and structured output keep
            working untouched.
          </p>
        </header>

        {/*
          Arc track.

          `overflow-hidden` is doing real work: the tiles that have rotated out
          of the window are parked past the edge rather than unmounted, so they
          have somewhere to slide in from. Without the clip they would widen the
          document and put a horizontal scrollbar on the page.

          The step between tiles is a variable rather than a breakpoint class on
          every tile, so one declaration here rescales the whole arc. `--arc-o2`
          folds the outer pair away on a phone, where the arc is narrower than
          two full steps.

          `--arc-lift` is headroom for the centre tile. It is scaled up from the
          104px base, and `scale` grows a box around its own centre, so its top
          edge lands 12px above where it is positioned and the clip above would
          shave it off. The tiles are pushed down by the lift, the track grows
          by it, and the top margin gives it back, so the arc sits exactly where
          it did and only the clip moves.
        */}
        <div
          className="
            relative mt-[calc(3rem_-_var(--arc-lift))] h-[calc(150px_+_var(--arc-lift))] overflow-hidden
            [--arc-lift:24px] [--arc-o2:0] [--arc-p1:104px] [--arc-p2:200px] [--arc-p3:296px]
            sm:h-[calc(190px_+_var(--arc-lift))] sm:[--arc-o2:1]
            sm:[--arc-p1:132px] sm:[--arc-p2:254px] sm:[--arc-p3:376px]
            lg:mt-[calc(4rem_-_var(--arc-lift))]
            lg:[--arc-p1:160px] lg:[--arc-p2:308px] lg:[--arc-p3:456px]
          "
        >
          {PROVIDERS.map((provider, index) => {
            const offset = ringOffset(index, focused)
            const distance = Math.abs(offset)
            const ring = RING[Math.min(distance, RING.length - 1)]!
            const isCentre = offset === 0
            // Beyond the window a tile is parked and inert: no paint, no hit
            // area, and out of the tab order, so nobody lands on a button they
            // cannot see.
            const parked = distance > 2
            const opacity = parked ? 0 : distance === 2 ? 'var(--arc-o2)' : 1

            return (
              <button
                key={provider.id}
                type="button"
                onClick={() => choose(focused + offset)}
                aria-label={`Show ${provider.name}`}
                aria-current={isCentre ? 'true' : undefined}
                aria-hidden={parked || undefined}
                tabIndex={parked ? -1 : undefined}
                /*
                 * Hover is a border change rather than a lift: the inline
                 * transform carries the arc geometry and any translate utility
                 * would replace it wholesale.
                 *
                 * A tile crossing the seam of the ring jumps the full width of
                 * the arc, so the transition is dropped while it is parked and
                 * the jump happens invisibly.
                 */
                className={`
                  absolute left-1/2 top-[var(--arc-lift)] flex h-[var(--arc-tile)] w-[var(--arc-tile)]
                  items-center justify-center rounded-tile border bg-bg-elev shadow-card
                  [--arc-tile:84px] sm:[--arc-tile:104px]
                  ${parked ? '' : 'transition-[transform,opacity,border-color] duration-[520ms] ease-out motion-reduce:transition-none'}
                  ${isCentre ? 'border-border' : 'border-track hover:border-border-strong'}
                  ${parked ? 'pointer-events-none' : ''}
                `}
                style={{
                  opacity,
                  transform: [
                    'translateX(-50%)',
                    `translateX(calc(${ring.pos} * ${Math.sign(offset)}))`,
                    `translateY(${ring.drop}px)`,
                    `rotate(${-Math.sign(offset) * ring.tilt}deg)`,
                    `scale(${ring.scale})`,
                  ].join(' '),
                }}
              >
                <ProviderMark
                  id={provider.id}
                  className={isCentre ? 'text-text' : 'text-text-muted'}
                  style={{ width: 'calc(var(--arc-tile) * 0.36)', height: 'calc(var(--arc-tile) * 0.36)' }}
                />
              </button>
            )
          })}
        </div>

        {/* Caption for the centre slot. `aria-live` so the rotation is
            announced rather than silently changing under a screen reader. */}
        <div className="mt-8 text-center lg:mt-2" aria-live="polite">
          <div key={active.id} className="sl-swap">
            <div className="font-display track-h3 text-[19px] text-text">{active.name}</div>
            <p className="mt-1.5 text-[14px] leading-[1.4] text-text-muted">{active.detail}</p>
          </div>
        </div>

        {/* Pager: one dot per provider, so the reader can see how far round the
            roster they are and jump straight to any of them. */}
        <div className="mt-8 flex items-center justify-center gap-2">
          {PROVIDERS.map((provider, index) => {
            const isCentre = ringOffset(index, focused) === 0
            return (
              <button
                key={provider.id}
                type="button"
                onClick={() => choose(focused + ringOffset(index, focused))}
                /* Not "Show X": the tile above already carries that name, and
                   two controls reading identically is a maze to navigate by
                   voice or screen reader. */
                aria-label={`Go to ${provider.name}`}
                aria-current={isCentre ? 'true' : undefined}
                className={`rounded-full transition-colors ${
                  isCentre
                    ? 'h-2 w-2 bg-accent-bright'
                    : 'h-1.5 w-1.5 bg-border-strong hover:bg-text-faint'
                }`}
              />
            )
          })}
        </div>
      </div>
    </section>
  )
}
