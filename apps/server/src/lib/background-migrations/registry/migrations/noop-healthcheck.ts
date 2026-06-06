import type { BackgroundMigration } from '../../index.js'

/**
 * Trivial background migration that does nothing and finishes
 * immediately. Two purposes:
 *
 *   1. Smoke test on every deploy — if the cron tick can pick
 *      this up, take the advisory lock, "run" a chunk, and flip the
 *      row to completed, the framework is wired correctly even when
 *      no real migration is in flight.
 *
 *   2. Documentation by example. The shape of `runChunk` and the
 *      idempotency contract are easiest to read from this file.
 *
 * Operationally: a row in `background_migrations` named
 * 'noop-healthcheck' that is in 'pending' state is the trigger.
 * To re-run the healthcheck just UPDATE the row's status back to
 * 'pending' and the next cron tick processes it.
 */
export const noopHealthcheck: BackgroundMigration = {
  name: 'noop-healthcheck',
  description:
    'No-op migration used to verify the background-migration framework end-to-end on every deploy.',

  async runChunk(_state) {
    // Real migrations would do their work here in bounded chunks
    // (e.g. SELECT 5000 rows, UPDATE them, return new cursor).
    // For the no-op we just declare we're done.
    return { done: true }
  },
}
