/**
 * /cron/prune-judge-cache (P3-18) — TTL-delete stale judge_cache rows so the
 * cache doesn't grow unbounded.
 *
 * The cache memoises (org, evaluator_config_hash, response_hash) → judge
 * outcome. A response written ~30 days ago is unlikely to be re-evaluated —
 * the prompt version + the production sample have probably both rolled over.
 * Keeping older rows just costs storage with no hit probability.
 *
 * Runs daily. Idempotent: a row stays only until its created_at + TTL.
 */

import { supabaseAdmin } from '../db.js'

export interface PruneJudgeCacheResult {
  ok: boolean
  deleted: number
  ttlDays: number
  error?: string
}

/** Days a judge_cache row lives before this cron deletes it. */
const TTL_DAYS = 30

export async function runPruneJudgeCacheJob(): Promise<PruneJudgeCacheResult> {
  const cutoff = new Date(Date.now() - TTL_DAYS * 24 * 60 * 60 * 1000).toISOString()
  try {
    // count: 'exact' here is cheap because the partial index on created_at
    // covers the WHERE clause directly.
    const { error, count } = await supabaseAdmin
      .from('judge_cache')
      .delete({ count: 'exact' })
      .lt('created_at', cutoff)
    if (error) return { ok: false, deleted: 0, ttlDays: TTL_DAYS, error: error.message }
    return { ok: true, deleted: count ?? 0, ttlDays: TTL_DAYS }
  } catch (err) {
    return {
      ok: false,
      deleted: 0,
      ttlDays: TTL_DAYS,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
