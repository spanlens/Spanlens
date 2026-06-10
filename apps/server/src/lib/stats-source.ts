/**
 * Phase 5.1 Stage 3 / R-12 Phase 3.2 — single-source-of-truth for which
 * ClickHouse table the stats pipeline reads from.
 *
 * `lib/stats-queries.ts` resolves this once per call and interpolates it
 * into every FROM clause. Both `requests` and `events_as_requests` (a view
 * defined in `clickhouse/migrations/005_create_events_as_requests_view.sql`)
 * expose the same column shape, so the rest of each query is unchanged.
 *
 * R-12 Phase 3.2 made this per-org: the source now depends on the calling
 * organization's `read_from_events` flag OR the `USE_EVENTS_FOR_STATS` env
 * gate (see `lib/events-read-flag.ts`). Flipping the fleet back is still
 * byte-identical to before: drop the env var, zero the DB flags, redeploy.
 */

import { useEventsForStats } from './events-read-flag.js'

export type StatsSource = 'requests' | 'events_as_requests'

export async function statsSource(organizationId: string): Promise<StatsSource> {
  return (await useEventsForStats(organizationId)) ? 'events_as_requests' : 'requests'
}
