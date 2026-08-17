import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { LogoMark } from '@/components/ui/logo'
import { ProviderMark, type ProviderId } from '@/components/landing/provider-marks'

/**
 * Hero: a field of provider tiles wired into the Spanlens mark, over the
 * headline and the two calls to action.
 *
 * Tiles, wires and pulses are all placed as percentages of the field rather
 * than in pixels, so the constellation keeps its shape as the field shrinks
 * instead of drifting apart from the wires that connect it.
 */

interface Tile {
  id: ProviderId
  /** Centre of the tile, as a percentage of the field. */
  left: number
  top: number
  /** Tile edge in px at the lg breakpoint; scaled down below it. */
  size: number
  /** Tiles beyond the four in the mobile comp are dropped on small screens. */
  wide?: boolean
}

const TILES: Tile[] = [
  { id: 'openai', left: 18.9, top: 39.4, size: 76 },
  { id: 'anthropic', left: 79.6, top: 35.2, size: 76 },
  { id: 'gemini', left: 85.6, top: 70.4, size: 68 },
  { id: 'groq', left: 27.4, top: 74.4, size: 84 },
  { id: 'mistral', left: 72.2, top: 78.4, size: 72, wide: true },
  { id: 'xai', left: 41.1, top: 29.6, size: 64, wide: true },
  { id: 'openrouter', left: 60.4, top: 27.2, size: 68, wide: true },
]

/** Centre of the field, where every wire terminates. */
const CORE = { left: 50, top: 50 }

/** When a given provider's tile, glyph and wire take the accent. */
function pingDelay(id: ProviderId): string {
  const slot = PING_ORDER.indexOf(id)
  return `${((slot < 0 ? 0 : slot) * PING_CYCLE) / PING_ORDER.length}s`
}

/**
 * One pass of the highlight around the constellation. Each tile holds the
 * accent for a slice of this, so the whole ring takes `PING_CYCLE` to come
 * round again.
 */
const PING_CYCLE = 9.8

/**
 * Order the ping travels in. Not the array order: the tiles are listed by
 * provider, and firing them in that order would jump the highlight back and
 * forth across the field. This walks it round the ring clockwise from the left.
 */
const PING_ORDER: ProviderId[] = [
  'openai',
  'xai',
  'openrouter',
  'anthropic',
  'gemini',
  'mistral',
  'groq',
]

/** Float period and phase per tile, chosen so no two neighbours rise together. */
const DRIFT_TIMING: { dur: number; delay: number }[] = [
  { dur: 7.5, delay: 0 },
  { dur: 8.6, delay: 1.2 },
  { dur: 9.2, delay: 0.5 },
  { dur: 7.9, delay: 1.8 },
  { dur: 8.2, delay: 0.8 },
  { dur: 9.6, delay: 2.1 },
  { dur: 8.9, delay: 1.5 },
]

export function Hero() {
  return (
    <section className="relative overflow-hidden px-4 pb-16 pt-10 sm:px-6 lg:px-10 lg:pb-[104px]">
      {/* Provider field */}
      <div className="relative mx-auto h-[260px] w-full max-w-[1240px] sm:h-[340px] lg:h-[500px]">
        {/* Warm bloom behind the constellation. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[420px] rounded-full bg-[radial-gradient(ellipse_at_center,var(--accent-bg),transparent_70%)] opacity-80" />

        {/*
         * Wires are drawn from the tile coordinates rather than hand-placed, so
         * every one terminates on a tile at any field size. The viewBox is the
         * percentage grid stretched to the field, which is why the stroke needs
         * `non-scaling-stroke` to stay a hairline instead of being squashed
         * with the geometry.
         */}
        <svg
          aria-hidden="true"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-0 hidden h-full w-full lg:block"
        >
          {TILES.map((t) => (
            <line
              key={t.id}
              className="sl-ping-wire"
              x1={CORE.left}
              y1={CORE.top}
              x2={t.left}
              y2={t.top}
              stroke="var(--border-strong)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
              style={{
                ['--sl-cycle' as string]: `${PING_CYCLE}s`,
                ['--sl-delay' as string]: pingDelay(t.id),
              }}
            />
          ))}
        </svg>

        {/*
         * Tile size travels as a custom property so one declaration can drive
         * both breakpoints: the comp runs 64-84px tiles on desktop and a flat
         * ~0.68 of that on mobile, where it also drops the name labels because
         * at 390 they collide with the neighbouring tiles.
         */}
        {TILES.map((t, i) => {
          const drift = DRIFT_TIMING[i] ?? { dur: 8, delay: 0 }
          return (
            <div
              key={t.id}
              className={`absolute -translate-x-1/2 -translate-y-1/2 ${t.wide ? 'hidden lg:block' : ''}`}
              style={{ left: `${t.left}%`, top: `${t.top}%`, ['--tile' as string]: `${t.size}px` }}
            >
              {/*
               * The float lives on an inner element. The positioning wrapper
               * above already owns a `-translate-x/y-1/2` transform, and an
               * animation on the same element would replace it and drop every
               * tile a half-width to the right.
               */}
              <div
                className="sl-drift"
                style={{
                  ['--sl-dur' as string]: `${drift.dur}s`,
                  ['--sl-delay' as string]: `${drift.delay}s`,
                }}
              >
                {/* The ping rides the tile face and the glyph, not the drifting
                    wrapper: both animate `transform`, and the second animation
                    on an element replaces the first rather than composing. */}
                <div
                  className="sl-ping flex h-[calc(var(--tile)*0.68)] w-[calc(var(--tile)*0.68)] items-center justify-center rounded-panel border border-border bg-bg-elev shadow-card lg:h-[var(--tile)] lg:w-[var(--tile)]"
                  style={{
                    ['--sl-cycle' as string]: `${PING_CYCLE}s`,
                    ['--sl-delay' as string]: pingDelay(t.id),
                  }}
                >
                  <ProviderMark
                    id={t.id}
                    className="sl-ping-mark h-[42%] w-[42%] text-text"
                    style={{
                      ['--sl-cycle' as string]: `${PING_CYCLE}s`,
                      ['--sl-delay' as string]: pingDelay(t.id),
                    }}
                  />
                </div>
                <div className="mt-2 hidden text-center font-mono text-[11.5px] leading-[1.3] text-text-faint lg:block">
                  {t.id}
                </div>
              </div>
            </div>
          )
        })}

        {/* The mark everything routes through. Larger than the provider tiles
            and carrying no chrome of its own, so it reads as the destination. */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <LogoMark
            size={104}
            className="h-[76px] w-[76px] rounded-tile shadow-card lg:h-[104px] lg:w-[104px]"
          />
        </div>
      </div>

      {/* Copy. Headline, sub and CTA row enter on load, 90ms apart, so the eye
          is walked down to the buttons instead of arriving everywhere at once. */}
      <div className="relative mx-auto mt-8 max-w-[900px] text-center lg:mt-2">
        <h1 className="sl-enter font-display track-display text-[38px] leading-[0.96] text-text sm:text-[64px] lg:text-[92px]">
          Every model call,
          <br />
          on the record.
        </h1>
        <p
          className="sl-enter mx-auto mt-6 max-w-[560px] text-[14.5px] leading-[1.58] text-text-muted sm:text-[17px]"
          style={{ ['--sl-delay' as string]: '90ms' }}
        >
          Swap one baseURL. Get cost, latency and full agent traces for every provider you already
          ship on.
        </p>
        <div
          className="sl-enter mt-8 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-center"
          style={{ ['--sl-delay' as string]: '180ms' }}
        >
          <Button asChild size="hero" variant="signal">
            <Link href="/signup">Start free</Link>
          </Button>
          <Button asChild size="hero" variant="outline">
            <Link href="/docs">Read the docs</Link>
          </Button>
        </div>
      </div>
    </section>
  )
}
