/**
 * Shared URL-building logic for anomaly "Investigate" links. Used by the
 * anomaly rows on /anomalies and the anomaly attention card on /dashboard
 * so both drill into /requests with identical prefilled filters
 * (provider + model + timeRange).
 */

export type InvestigateRange = 'today' | '7d' | '30d'

/**
 * Map an anomaly observation window (in hours) to the /requests `timeRange`
 * param. 1h / 24h observations both fit inside `today` (24h); up to 7d maps
 * to the 7d range; anything longer falls back to 30d.
 */
export function investigateRangeForObservationHours(obsHours: number): InvestigateRange {
  if (obsHours <= 24) return 'today'
  if (obsHours <= 24 * 7) return '7d'
  return '30d'
}

/** Build the /requests href with provider / model / timeRange prefilled. */
export function buildInvestigateHref(
  provider: string,
  model: string,
  range: InvestigateRange,
): string {
  return `/requests?provider=${encodeURIComponent(provider)}&model=${encodeURIComponent(model)}&timeRange=${range}`
}
