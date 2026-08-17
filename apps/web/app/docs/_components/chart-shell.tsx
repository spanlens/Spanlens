/**
 * Presentational shells for the five /docs recharts figures.
 *
 * This module deliberately imports NO recharts. It holds the parts of each
 * figure that are cheap enough to server-render: the <figure> element, the
 * fixed-height box the chart draws into, the radar legend, and the
 * <figcaption>. The recharts body that fills the box lives in ./charts and is
 * loaded lazily and client-only (see ./lazy-chart-bodies).
 *
 * Two reasons that split is worth a separate file:
 *
 * 1. Layout stability. The chart body swaps in after hydration, so something
 *    has to hold its space in the meantime. Because the box is a fixed height
 *    the server already rendered, the swap is a pure in-place replacement of
 *    the box's contents and cannot move anything below it. No CLS, and no
 *    guessing at a placeholder height that "looks about right" — the shell
 *    owns the single height value that both the placeholder and the chart use.
 *
 * 2. SEO. /docs pages are indexed and the captions are prose. Making the whole
 *    figure client-only would drop the caption text out of the crawled HTML.
 *    Keeping the shell on the server means only the SVG — which carries no
 *    indexable content — is client-only.
 *
 * The heights below are the ones the charts actually draw at today: 280px for
 * the four bar/area figures and 360px for the radar. The recharts bodies size
 * themselves to fill these boxes via `<ResponsiveContainer width="100%"
 * height="100%">`, so changing a height here is the only edit needed.
 */

import type { ReactNode } from 'react'

/**
 * Chart palette, handed to recharts as SVG `fill`/`stroke` values.
 *
 * These are `var()` references rather than literals so the figures follow the
 * theme: recharts passes the string straight through to an SVG attribute, and
 * SVG paint accepts custom properties, so a dark-mode toggle repaints the
 * charts with no JS. Anything added here must be a token, not a hex.
 */
export const COLORS = {
  accent: 'var(--accent)',
  accentLight: 'var(--accent-bright)',
  muted: 'var(--text-faint)',
  mutedLight: 'var(--track)',
  bg: 'var(--bg-elev)',
  text: 'var(--text)',
  textMuted: 'var(--text-muted)',
  good: 'var(--good)',
}

/** Every shell takes the chart body (or its placeholder) as children. */
interface ChartShellProps {
  children: ReactNode
}

interface FigureProps {
  caption: string
  children: ReactNode
}

/**
 * Standard figure: a 280px-tall bordered box plus a caption underneath.
 *
 * The height is a Tailwind class rather than the `style={{ height }}` prop this
 * used to carry. Every caller wanted the default, and the repo bans inline
 * styles, so the prop bought nothing.
 */
function Figure({ caption, children }: FigureProps) {
  return (
    <figure className="not-prose my-6">
      <div className="h-[280px] rounded-lg border border-border bg-bg-elev p-4">
        {children}
      </div>
      <figcaption className="mt-2 text-xs text-muted-foreground text-center">
        {caption}
      </figcaption>
    </figure>
  )
}

/**
 * Fills whatever box it is dropped into. Deliberately unanimated and
 * background-free: these figures sit inside long prose pages, and a pulsing
 * gray block mid-paragraph reads as a broken image rather than as loading.
 * The box already has a visible border, so the reserved space is legible.
 */
export function ChartPlaceholder() {
  return <div className="h-full w-full" aria-hidden="true" />
}

/* ───────────────────────── 1. Prompt A/B: p-value + CI ───────────────────────── */

export function PromptAbFigure({ children }: ChartShellProps) {
  return (
    <Figure caption="Two prompt versions on a 0..1 quality score with 95% confidence intervals. Welch's t-test result is shown above the winning bar, where p < 0.05 means the difference is unlikely to be noise.">
      {children}
    </Figure>
  )
}

/* ───────────────────────── 2. Anomalies: 3-sigma distribution ───────────────────────── */

export function AnomalyFigure({ children }: ChartShellProps) {
  return (
    <Figure caption="Anomaly = a sample beyond ±3σ of the rolling baseline. Roughly 0.3% of normal samples land there by chance, so persistent breaches signal a real shift, not noise.">
      {children}
    </Figure>
  )
}

/* ───────────────────────── 3. Cost tracking: model price comparison ───────────────────────── */

export function ModelPriceFigure({ children }: ChartShellProps) {
  return (
    <Figure caption="Input vs output price per 1M tokens for popular models (May 2026 list rates). Output is typically 4 to 5 times input, so your prompt-to-completion ratio drives total spend more than model choice alone.">
      {children}
    </Figure>
  )
}

/* ───────────────────────── 4. Billing: plan quotas ───────────────────────── */

export function PlanQuotaFigure({ children }: ChartShellProps) {
  return (
    <Figure caption="Monthly request quota (left) and retention window (right) per plan. The Enterprise bar is shown at an illustrative 10M to keep the chart readable; the actual Enterprise quota is unlimited and negotiated per contract. Paid quotas overflow into metered overage at the rate shown in the billing table.">
      {children}
    </Figure>
  )
}

/* ───────────────────────── 5. Why: feature coverage radar ───────────────────────── */

export type RadarSeriesKey = 'Spanlens' | 'Helicone' | 'Langfuse' | 'LangSmith'

export interface RadarSeries {
  name: string
  color: string
  key: RadarSeriesKey
}

/**
 * Shared by the shell (which draws the HTML legend) and the recharts body
 * (which draws one <Radar> per entry). Both must agree on colors or the legend
 * stops matching the polygons, so this is the single definition.
 */
export const RADAR_SERIES: RadarSeries[] = [
  { name: 'Spanlens', key: 'Spanlens', color: COLORS.accent },
  { name: 'Helicone', key: 'Helicone', color: COLORS.muted },
  // The palette carries one accent and no categorical ramp, so the remaining
  // two series borrow the status hues. They only need to be told apart from
  // each other and from the accent, which green and amber manage.
  { name: 'Langfuse', key: 'Langfuse', color: 'var(--good)' },
  { name: 'LangSmith', key: 'LangSmith', color: 'var(--warn)' },
]

/**
 * The radar figure does not use `Figure`: it is taller (360px) and carries a
 * hand-rolled legend below the chart, because recharts' own <Legend> does not
 * lay out well against a polar chart at this width.
 *
 * The legend is part of the shell rather than the chart body on purpose. It is
 * the piece a reader needs in order to interpret the polygons, it costs
 * nothing to render, and keeping it server-side means the four competitor
 * names stay in the crawled HTML.
 */
export function FeatureCoverageFigure({ children }: ChartShellProps) {
  return (
    <figure className="not-prose my-6">
      <div className="rounded-lg border border-border bg-bg-elev p-4">
        <div className="h-[360px]">{children}</div>
        {/* The two `style` props below are the one place inline styles are
            unavoidable: the swatch and label colors come from RADAR_SERIES at
            runtime, so there is no class name to reach for. The values are
            still `var()` token references, so they follow the theme. */}
        <div className="mt-3 flex flex-wrap justify-center gap-x-5 gap-y-2 text-[11px]">
          {RADAR_SERIES.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-3 w-3 rounded-sm"
                style={{ backgroundColor: s.color, opacity: 0.7 }}
              />
              <span style={{ color: s.color }} className="font-medium">
                {s.name}
              </span>
            </span>
          ))}
        </div>
      </div>
      <figcaption className="mt-2 text-xs text-muted-foreground text-center">
        Coverage score across six differentiator axes. The bigger the polygon, the broader the
        out-of-box capability. Read it alongside the detailed checkmark table above.
      </figcaption>
    </figure>
  )
}
