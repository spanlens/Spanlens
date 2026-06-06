/**
 * Background migration runner.
 *
 * Called by the 5-minute cron at `/cron/run-background-migrations`.
 * Picks one eligible migration row, takes a Postgres advisory lock,
 * runs `runChunk` in a loop until it's either done or close to the
 * Vercel function timeout, persists state + heartbeat as it goes,
 * releases the lock.
 *
 * Designed for fail-safety:
 *
 *   • Two concurrent cron firings can't run the same migration. The
 *     advisory lock fails open — if we can't acquire it, we skip and
 *     try a different migration.
 *   • A crashed worker that left `status='running'` gets reclaimed by
 *     the next tick once `last_heartbeat_at` is older than
 *     `HEARTBEAT_STALE_MS`. The advisory lock is automatically
 *     released by Postgres when the original connection drops, so
 *     reclaim only has to handle the row state.
 *   • Any thrown error in `runChunk` flips the row to 'failed' and
 *     stamps `error_message`, releases the lock, returns. The cron's
 *     outer try/catch is the last line of defense.
 */

import type { BackgroundMigration, ChunkState } from './index.js'
import {
  CHUNK_BUDGET_MS,
  HEARTBEAT_STALE_MS,
  HEARTBEAT_TICK_MS,
} from './index.js'
import { supabaseAdmin } from '../db.js'
import { getRegistry } from './registry/index.js'

/**
 * Minimal projection of the row the runner actually reads from. Avoids
 * pulling in the supabase/types.ts Database type, which lives outside
 * the server's tsconfig rootDir.
 */
interface BgMigrationRow {
  name: string
  status: string
  state: unknown
  started_at: string | null
  attempts: number
  last_heartbeat_at: string | null
}

/**
 * One-shot entry point for the cron. Returns a summary so the cron
 * handler can render a meaningful JSON response and log it. NEVER
 * throws — every failure is caught and reported in the result.
 */
export async function runDueMigrations(): Promise<{
  picked: string | null
  chunks: number
  status: 'completed' | 'paused' | 'failed' | 'skipped'
  errorMessage?: string
}> {
  // 1) Mark stale 'running' rows back to 'pending' so we can pick them
  //    up again. We do this BEFORE selecting the candidate so a crashed
  //    worker doesn't park a migration forever.
  const staleCutoff = new Date(Date.now() - HEARTBEAT_STALE_MS).toISOString()
  await supabaseAdmin
    .from('background_migrations')
    .update({ status: 'pending' })
    .eq('status', 'running')
    .lt('last_heartbeat_at', staleCutoff)

  // 2) Pick the oldest 'pending' migration that's in the code-side
  //    registry. A row whose `name` was removed from the registry
  //    stays pending forever, which is the desired behaviour — we
  //    refuse to silently drop registrations.
  const registry = getRegistry()
  const registeredNames = Array.from(registry.keys())
  if (registeredNames.length === 0) {
    return { picked: null, chunks: 0, status: 'skipped' }
  }

  const { data: candidate } = await supabaseAdmin
    .from('background_migrations')
    .select('*')
    .eq('status', 'pending')
    .in('name', registeredNames)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!candidate) {
    return { picked: null, chunks: 0, status: 'skipped' }
  }

  const migration = registry.get(candidate.name)
  if (!migration) {
    // Defensive — the .in() above should have filtered this out, but
    // a race between registry refresh and the SELECT could in theory
    // surface a row whose registration was just removed.
    return { picked: candidate.name, chunks: 0, status: 'skipped' }
  }

  // 3) Take the advisory lock. If someone else has it, bail — the
  //    next cron tick will retry.
  const { data: lockResult, error: lockErr } = await supabaseAdmin.rpc(
    'try_advisory_lock_for_migration',
    { p_name: candidate.name },
  )
  if (lockErr || !lockResult) {
    return { picked: candidate.name, chunks: 0, status: 'skipped' }
  }

  // 4) Flip to 'running', stamp the heartbeat, bump attempts. From
  //    here on we MUST release the lock before returning.
  try {
    const startedAt = new Date().toISOString()
    await supabaseAdmin
      .from('background_migrations')
      .update({
        status: 'running',
        started_at: candidate.started_at ?? startedAt,
        last_heartbeat_at: startedAt,
        attempts: (candidate.attempts ?? 0) + 1,
      })
      .eq('name', candidate.name)

    const result = await runChunkLoop(migration, candidate)
    return result
  } catch (err) {
    // Catch-all so the lock always releases. Mark the row failed so a
    // human can intervene rather than silently retrying forever.
    const message = err instanceof Error ? err.message : 'unknown error'
    await supabaseAdmin
      .from('background_migrations')
      .update({
        status: 'failed',
        error_message: message,
        completed_at: new Date().toISOString(),
      })
      .eq('name', candidate.name)
    return {
      picked: candidate.name,
      chunks: 0,
      status: 'failed',
      errorMessage: message,
    }
  } finally {
    await supabaseAdmin.rpc('release_advisory_lock_for_migration', {
      p_name: candidate.name,
    })
  }
}

/**
 * Run chunks until done, until the time budget is gone, or until
 * something throws. Stamps heartbeat + state between chunks.
 */
async function runChunkLoop(
  migration: BackgroundMigration,
  row: BgMigrationRow,
): Promise<{
  picked: string
  chunks: number
  status: 'completed' | 'paused' | 'failed'
  errorMessage?: string
}> {
  const startedAtMs = Date.now()
  let state: ChunkState = (row.state ?? {}) as ChunkState
  let chunks = 0
  let lastHeartbeat = Date.now()

  for (;;) {
    // Yield if we've burned our budget. Persist whatever state we
    // have — the next cron tick resumes here.
    if (Date.now() - startedAtMs > CHUNK_BUDGET_MS) {
      await supabaseAdmin
        .from('background_migrations')
        .update({
          status: 'pending',
          state: state as Record<string, unknown>,
          last_heartbeat_at: new Date().toISOString(),
        })
        .eq('name', row.name)
      return { picked: row.name, chunks, status: 'paused' }
    }

    let chunkResult
    try {
      chunkResult = await migration.runChunk(state)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'runChunk threw'
      await supabaseAdmin
        .from('background_migrations')
        .update({
          status: 'failed',
          error_message: message,
          completed_at: new Date().toISOString(),
        })
        .eq('name', row.name)
      return {
        picked: row.name,
        chunks,
        status: 'failed',
        errorMessage: message,
      }
    }
    chunks += 1

    if (chunkResult.done) {
      await supabaseAdmin
        .from('background_migrations')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          last_heartbeat_at: new Date().toISOString(),
          error_message: null,
        })
        .eq('name', row.name)
      return { picked: row.name, chunks, status: 'completed' }
    }

    state = chunkResult.state

    // Stamp heartbeat + progress periodically so the admin UI updates
    // and the stale-recovery logic doesn't reclaim a healthy worker.
    if (Date.now() - lastHeartbeat > HEARTBEAT_TICK_MS) {
      const update: Record<string, unknown> = {
        state,
        last_heartbeat_at: new Date().toISOString(),
      }
      if (chunkResult.progressCurrent != null) {
        update['progress_current'] = chunkResult.progressCurrent
      }
      if (chunkResult.progressTotal != null) {
        update['progress_total'] = chunkResult.progressTotal
      }
      await supabaseAdmin
        .from('background_migrations')
        .update(update)
        .eq('name', row.name)
      lastHeartbeat = Date.now()
    }
  }
}
