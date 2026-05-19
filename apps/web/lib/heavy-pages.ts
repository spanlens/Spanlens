/**
 * Pages whose page.tsx runs a costly prefetchAll (multiple specs and/or single
 * spec hitting COUNT(*) or ClickHouse window functions).
 *
 * Anywhere we render a `<Link>` to one of these paths from a high-fanout
 * surface (sidebar, KPI cards, drill-downs), we set `prefetch={false}` so the
 * server isn't pelted with sibling-page RSC fetches every time the surface
 * mounts. The page still prefetches on hover, so the UX cost of the first
 * click is minimal.
 *
 * Keep this list in sync with the actual prefetch weight in each page.tsx —
 * see docs/plans/dashboard-load-perf-2026-05.md §5.
 */
const HEAVY_PAGES = new Set<string>([
  '/dashboard',
  '/requests',
  '/traces',
  '/users',
  '/anomalies',
  '/security',
  '/savings',
  '/alerts',
])

export function isHeavyPage(href: string): boolean {
  return HEAVY_PAGES.has(href)
}

/**
 * Helper for `<Link prefetch={...}>` — returns `false` for heavy pages so
 * viewport prefetch is skipped, `'auto'` otherwise so light pages keep their
 * default smart-prefetch behavior.
 */
export function linkPrefetchFor(href: string): false | 'auto' {
  return isHeavyPage(href) ? false : 'auto'
}
