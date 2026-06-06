/**
 * Phase 5.1 Stage 3 — single-source-of-truth for which ClickHouse table
 * the stats pipeline reads from.
 *
 * `lib/stats-queries.ts` interpolates this into every FROM clause so a
 * Vercel env flip swaps the data source for the whole stats pipeline
 * at once. Both `requests` and `events_as_requests` (a view defined in
 * `clickhouse/migrations/005_create_events_as_requests_view.sql`) expose
 * the same column shape, so the rest of each query is unchanged.
 *
 * Flipping back is byte-identical to today: drop the env var and
 * redeploy.
 */

import { useEventsForRequests } from './feature-flags.js'

export function statsSource(): string {
  return useEventsForRequests ? 'events_as_requests' : 'requests'
}
