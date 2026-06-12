/**
 * Shared currency / time / number formatters used across the dashboard.
 *
 * Why this file exists: the audit on 2026-06-12 found `fmtCost` redefined in
 * 19 separate files. That number is misleading on its own — the call sites
 * actually split into three INTENTIONAL display modes (KPI headline,
 * dense table row, summary band). Collapsing them to a single function
 * would change the visual output across the dashboard. Instead, this file
 * exports three named helpers with explicit semantics; the 19 call sites
 * import the matching one and the duplicated bodies disappear.
 *
 * When choosing between them:
 *   - `fmtCostKpi(n)`     — large bold KPI cards, sparkline labels, spend
 *                           forecast headline. en-US thousand separators,
 *                           always 2 fraction digits, no zero/null mask.
 *   - `fmtCostDense(n)`   — per-request / per-trace table rows where the
 *                           column needs to align vertically and tiny
 *                           amounts (< $0.001) still need to read as
 *                           non-zero. Always 5 fraction digits, null → "—".
 *   - `fmtCostSummary(n)` — per-user / per-session aggregate cells in
 *                           list tables. 2 fraction digits, but with the
 *                           "< $0.01" cutoff so a $0.0003 row doesn't
 *                           render as "$0.00" and look broken.
 *
 * The three modes are not interchangeable — passing the same number through
 * each produces different strings on purpose. A regression test pinning
 * those strings lives in lib/format.test.ts.
 */

/**
 * KPI / headline formatter. en-US thousand separators, always 2 fraction
 * digits. Returns "$0.00" for null/zero — KPI cards are designed to always
 * show a number so the layout doesn't reflow when data is missing.
 */
export function fmtCostKpi(n: number | null | undefined): string {
  const v = n ?? 0
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/**
 * Dense per-row formatter for /requests, /traces table cells. 5 fraction
 * digits so trailing zeros are visible (eyeballing $0.00020 vs $0.00200
 * shouldn't require counting digits). Null → "—". Zero → "—" so empty rows
 * don't pretend to have data.
 */
export function fmtCostDense(n: number | null | undefined): string {
  if (n == null || n <= 0) return '—'
  return '$' + n.toFixed(5)
}

/**
 * Aggregate-summary formatter for /users, /sessions list cells. 2 fraction
 * digits with the "< $0.01" cutoff so a $0.0003 aggregate doesn't render as
 * "$0.00" (which reads as "no cost" and surprises operators when they drill
 * in). Null → "—".
 */
export function fmtCostSummary(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n === 0) return '$0.00'
  return n < 0.01 ? '< $0.01' : '$' + n.toFixed(2)
}
