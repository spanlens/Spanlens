/**
 * Background migration framework — public types + helpers.
 *
 * A background migration is a long-running data backfill (or cleanup,
 * or one-shot transformation) that we can't squeeze into the normal
 * SQL migration step because:
 *
 *   • It would block a request: rewriting hundreds of millions of
 *     ClickHouse rows holds locks long enough to spike p99.
 *   • It wouldn't finish in 5 minutes: Vercel's serverless functions
 *     get killed at the 5-min mark, taking a half-done backfill with
 *     them.
 *
 * The pattern (lifted from Langfuse / PostHog):
 *
 *   1. Ship the SQL migration first, adding columns nullable.
 *   2. Register a `BackgroundMigration` whose `runChunk(state)`
 *      processes ~5000 rows and returns the next cursor.
 *   3. A cron picks it up, takes a Postgres advisory lock so two
 *      workers don't race, runs chunks until close to the function
 *      timeout, persists `state`, yields.
 *   4. Next tick resumes from `state`. Eventually `runChunk` returns
 *      `done: true` and the row goes to `status='completed'`.
 *
 * Migrations register themselves in `./registry/index.ts`. The runner
 * lives in `./runner.ts`.
 */

export interface BackgroundMigration {
  /** Stable identifier — must match the row's primary key. */
  name: string

  /** Human-facing description, shown in the admin UI. */
  description: string

  /**
   * Run one bounded chunk of work and return either a new state for
   * the next chunk or `{done: true}` to flip the row to completed.
   *
   * MUST be idempotent — the same chunk may run twice if a worker
   * crashes between completing work and persisting state.
   *
   * Should aim to finish in well under 60s so the heartbeat stays
   * fresh; the runner pauses between chunks but can't interrupt a
   * single call.
   */
  runChunk(state: ChunkState): Promise<ChunkResult>
}

/** Free-form per-migration state. The framework treats it as opaque. */
export type ChunkState = Record<string, unknown>

export type ChunkResult =
  | {
      /** More work to do. The runner persists this state and decides
       *  whether to run another chunk in this tick or yield. */
      done: false
      state: ChunkState
      /** Optional progress hints for the admin UI. Both fields go on
       *  the row as `progress_current` / `progress_total`. */
      progressCurrent?: number
      progressTotal?: number
    }
  | { done: true }

// ── Constants the runner cares about ─────────────────────────────────────────

/** Function timeout we must respect (Vercel Pro maxDuration = 300s). */
export const FUNCTION_TIMEOUT_MS = 300_000

/**
 * Stop launching new chunks after this much wall-clock has elapsed so
 * the runner has room to persist state and release the lock cleanly.
 * Picked at 240s so we always have a 60s buffer for the final write
 * + advisory-unlock round trip.
 */
export const CHUNK_BUDGET_MS = 240_000

/**
 * If `last_heartbeat_at` is older than this, the row is treated as
 * "crashed" — the next tick can reclaim it even though status is
 * still 'running'.
 */
export const HEARTBEAT_STALE_MS = 60_000

/** How often the runner stamps `last_heartbeat_at` while it's running. */
export const HEARTBEAT_TICK_MS = 15_000
