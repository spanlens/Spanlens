'use client'

/**
 * The one and only `import()` of ./charts.
 *
 * WHY ALL FIVE NAME THE SAME SPECIFIER (bundle size, not ergonomics):
 *
 * Turbopack groups async chunks by `import()` site, not by shared ancestry.
 * Five distinct specifiers means five async chunk groups, and each group gets
 * its own copy of the recharts vendor graph. This was measured on the
 * dashboard, where five separately-specified chart cards produced three
 * byte-identical 361,565-byte recharts blobs on a single page load. See the
 * header comment in components/dashboard/charts.tsx for the full write-up,
 * including the "shared barrel of recharts primitives" approach that was tried
 * and did not work — a common ancestor module does not make the bundler hoist.
 * The specifier is the lever.
 *
 * So: adding a sixth docs figure means adding it to ./charts and giving it a
 * wrapper here. Giving it its own `dynamic(() => import('./my-new-chart'))`
 * re-forks the vendor chunk and silently costs another ~116 KB gzip.
 *
 * The trade-off is that any docs page with a figure downloads all five chart
 * bodies. That is deliberate and cheap: the bodies are a few hundred bytes of
 * JSX each next to the recharts runtime they all share.
 *
 * WHY `ssr: false` IS LOAD-BEARING:
 *
 * `ResponsiveContainer` measures itself with ResizeObserver, which does not
 * exist during SSR. A server render emits a 0-width SVG that the client
 * repaints at the real width — React #418, CLAUDE.md gotcha #22 (D). Every
 * other recharts usage in this codebase already sets `ssr: false`; the docs
 * figures were the one place it was missed, and production HTML for /docs/why
 * carried the 0-width `recharts-surface` to prove it.
 *
 * Losing the server render costs nothing here. The figures are illustrative,
 * and the indexable content around them — caption, legend, and the tables the
 * pages already carry — is rendered by ./chart-shell on the server.
 */

import dynamic from 'next/dynamic'
import { ChartPlaceholder } from './chart-shell'

// Each `loading` placeholder is rendered inside a shell box that is already the
// chart's final height (280px, or 360px for the radar — see ./chart-shell), so
// the fallback only has to fill it. Nothing below the figure can move when the
// real chart arrives.
//
// The options object is written out at every call site rather than hoisted into
// a shared const. `next/dynamic` is compiled by an SWC transform that reads the
// options *literal* to decide how to treat the import, and passing the object
// by reference is not a shape it is documented to handle. Every other
// `dynamic()` in this repo inlines it too.
export const LazyPromptAbChart = dynamic(
  () => import('./charts').then((m) => m.PromptAbChartBody),
  { ssr: false, loading: () => <ChartPlaceholder /> },
)

export const LazyAnomalyChart = dynamic(
  () => import('./charts').then((m) => m.AnomalyChartBody),
  { ssr: false, loading: () => <ChartPlaceholder /> },
)

export const LazyModelPriceChart = dynamic(
  () => import('./charts').then((m) => m.ModelPriceChartBody),
  { ssr: false, loading: () => <ChartPlaceholder /> },
)

export const LazyPlanQuotaChart = dynamic(
  () => import('./charts').then((m) => m.PlanQuotaChartBody),
  { ssr: false, loading: () => <ChartPlaceholder /> },
)

export const LazyFeatureCoverageRadar = dynamic(
  () => import('./charts').then((m) => m.FeatureCoverageRadarBody),
  { ssr: false, loading: () => <ChartPlaceholder /> },
)
