/**
 * Background migration registry.
 *
 * Every shipping migration is registered here. The runner picks
 * candidates by intersecting the DB rows with this map, so a
 * registration that's been removed from the codebase silently stops
 * being processed (the DB row stays in 'pending' until a human
 * cancels it).
 *
 * To ship a new background migration:
 *
 *   1. Land the SQL schema change first (nullable columns / defaults
 *      that don't require backfill at write time).
 *   2. Write a `BackgroundMigration` implementation under
 *      `./migrations/<name>.ts`.
 *   3. Import it here and add it to the map.
 *   4. INSERT a row into `background_migrations` with the same
 *      `name` and `status='pending'`. The next cron tick will pick
 *      it up. A repeatable seed script is preferred so dev / staging
 *      / prod stay in sync.
 *   5. Write a unit test covering at least a single happy-path
 *      `runChunk` call plus the "no work left" case.
 */

import type { BackgroundMigration } from '../index.js'
import { noopHealthcheck } from './migrations/noop-healthcheck.js'
import { backfillEventsFromRequests } from './migrations/backfill-events-from-requests.js'

const REGISTRY = new Map<string, BackgroundMigration>([
  // Always-registered no-op so the cron has something to exercise on
  // a fresh deploy. Safe to run anytime — it just yields immediately.
  [noopHealthcheck.name, noopHealthcheck],

  // Phase 5.1 Stage 2 — backfill historical requests into the new
  // events table. INSERT a row into `background_migrations` with
  // name='backfill-events-from-requests' to start it; the cron will
  // pick it up on the next 5-minute tick.
  [backfillEventsFromRequests.name, backfillEventsFromRequests],
])

export function getRegistry(): ReadonlyMap<string, BackgroundMigration> {
  return REGISTRY
}

/**
 * Register an additional migration at runtime (currently used only
 * by tests — production registrations should be inline in this file
 * so a `git grep` finds them all).
 */
export function _registerForTests(migration: BackgroundMigration): void {
  REGISTRY.set(migration.name, migration)
}

export function _unregisterForTests(name: string): void {
  REGISTRY.delete(name)
}
