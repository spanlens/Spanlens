/**
 * Single lazy entry point for every recharts-backed dashboard card.
 *
 * WHY THIS FILE EXISTS (bundle size, not ergonomics):
 *
 * `/dashboard` and `/demo/dashboard` each mount five chart cards, and each card
 * used to be pulled in through its own `next/dynamic(() => import('...'))`
 * specifier. Five distinct specifiers means five async chunk groups, and
 * Turbopack emits a vendor copy of the recharts graph per group rather than
 * hoisting one shared copy. Measured on Next 16.2.7 + Turbopack: the five cards
 * were grouped 2 + 2 + 1, so a single `/dashboard` page load downloaded
 * **three** byte-identical 361,565-byte recharts blobs — ~1,190 KB of chart
 * chunks for what is one chart library.
 *
 * Routing every card through this one module collapses that to a single
 * `import()` target: five `dynamic()` calls that all name
 * `@/components/dashboard/charts` resolve to the same async chunk group, so
 * recharts is emitted once.
 *
 * A previous attempt put a shared re-export of the recharts *primitives* in
 * `components/charts/recharts.ts` on the theory that a common ancestor module
 * would let the bundler hoist. It was rebuilt and measured: still 8 chunks /
 * 1,190 KB, three copies unchanged. Turbopack groups by `import()` site, not by
 * shared ancestry, so that approach was reverted. Do not reintroduce it — the
 * specifier is the lever.
 *
 * NOTES FOR FUTURE EDITS:
 *
 * - Adding a sixth recharts card? Re-export it here and load it from this
 *   module. Giving it its own `dynamic(() => import('@/components/dashboard/
 *   my-new-chart'))` re-forks the vendor chunk and silently costs another
 *   ~102 KB gzip per page load.
 * - The trade-off is that opening any one card downloads all five card
 *   components. That is deliberate: the card code is small next to recharts
 *   itself, which every one of them needs anyway, and all five render on the
 *   same screen.
 * - Consumers must still wrap these in `next/dynamic(..., { ssr: false })`.
 *   `ResponsiveContainer` measures itself with ResizeObserver, which does not
 *   exist during SSR — a server render produces a 0-width SVG that mismatches
 *   the client paint (CLAUDE.md gotcha #22 D). This module is deliberately not
 *   imported statically anywhere.
 */

export { RequestChart } from './request-chart'
export { SpendForecastCard } from './spend-forecast'
export { CostBreakdownCard } from './cost-breakdown'
export { TokenTrendsCard } from './token-trends'
export { ErrorDistributionCard } from './error-distribution'
