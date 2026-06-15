/**
 * P3-18: judge result cache.
 *
 * Memoises (organization, evaluator_config, response_text) → judge outcome so
 * a re-evaluation of the same sample with the same evaluator doesn't re-charge
 * the judge LLM. Cache hits return the stored score / reasoning at $0.
 *
 * Hashing is deterministic over a stable JSON serialisation of the relevant
 * judge fields — editing the evaluator (criterion, model, rubric, anchors)
 * naturally rotates the hash and invalidates entries, so there's no separate
 * invalidation API. SHA-256 from lib/crypto.ts is used for both hashes.
 */

import { supabaseAdmin } from '../db.js'
import { sha256Hex } from '../crypto.js'
import type { JudgeConfig } from './judge-prompt.js'

/** Cached outcome shape stored on judge_cache. Mirrors JudgeOutcome's
 *  value columns plus the original (pre-cache) call's cost / tokens. */
export interface CachedJudgeOutcome {
  score: number | null
  value_number: number | null
  value_string: string | null
  value_boolean: boolean | null
  value_raw_number: number | null
  reasoning: string
  /** Cost of the ORIGINAL judge call. The cache hit itself bills $0; this is
   *  kept so dashboards can report cumulative savings. */
  original_cost_usd: number
  original_tokens: number
}

/**
 * Build a deterministic hash of the judge config fields that materially affect
 * the score. Anything in this set must rotate the cache: criterion + provider
 * + model + scale + score_config_id + rubric + anchors.
 *
 * Object key ordering inside JSON.stringify is browser/runtime-defined for
 * unknown property orders, so we serialise field-by-field in a fixed order.
 */
export async function hashEvaluatorConfig(config: JudgeConfig): Promise<string> {
  // Anchors: serialise each anchor in a fixed shape too. Empty array and
  // missing field hash identically so an evaluator created without anchors
  // and one that had its anchors deleted match the same cache rows.
  const anchors = (config.anchors ?? []).map((a) => ({
    response: a.response,
    score: a.score,
    reasoning: a.reasoning ?? null,
  }))
  const payload = JSON.stringify({
    criterion: config.criterion,
    judge_provider: config.judge_provider,
    judge_model: config.judge_model,
    scale_min: config.scale_min,
    scale_max: config.scale_max,
    score_config_id: config.score_config?.id ?? null,
    rubric: config.rubric?.trim() ? config.rubric.trim() : null,
    anchors,
  })
  return sha256Hex(payload)
}

/**
 * Hash the sample inputs that fed the judge prompt. The expected_output
 * (golden answer from P1-6 dataset items) is included so the same response
 * with a different golden reference doesn't return the cached score for
 * "criterion only".
 */
export function hashSampleInputs(responseText: string, expectedOutput: string | null): Promise<string> {
  return sha256Hex(`${responseText}\x00${expectedOutput ?? ''}`)
}

/**
 * Look up a cached judge outcome. Returns the cached row or null when the
 * cache misses (or the lookup itself fails — caches must never break the
 * caller's hot path).
 */
export async function lookupJudgeCache(args: {
  organizationId: string
  configHash: string
  responseHash: string
}): Promise<CachedJudgeOutcome | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from('judge_cache')
      .select('score, value_number, value_string, value_boolean, value_raw_number, reasoning, original_cost_usd, original_tokens')
      .eq('organization_id', args.organizationId)
      .eq('evaluator_config_hash', args.configHash)
      .eq('response_hash', args.responseHash)
      .maybeSingle()
    if (error || !data) return null
    return {
      score: (data.score as number | null) ?? null,
      value_number: (data.value_number as number | null) ?? null,
      value_string: (data.value_string as string | null) ?? null,
      value_boolean: (data.value_boolean as boolean | null) ?? null,
      value_raw_number: (data.value_raw_number as number | null) ?? null,
      reasoning: (data.reasoning as string | null) ?? '',
      original_cost_usd: Number(data.original_cost_usd ?? 0),
      original_tokens: Number(data.original_tokens ?? 0),
    }
  } catch {
    return null
  }
}

/**
 * Insert a fresh outcome into the cache. Uses an ON CONFLICT DO NOTHING via
 * the natural-key unique constraint, so a race between two judge calls of the
 * same sample doesn't double-insert. Errors are swallowed — a write failure
 * just means the next call won't hit the cache, never a user-visible failure.
 */
export async function storeJudgeCache(args: {
  organizationId: string
  configHash: string
  responseHash: string
  outcome: CachedJudgeOutcome
}): Promise<void> {
  try {
    await supabaseAdmin.from('judge_cache').upsert(
      {
        organization_id: args.organizationId,
        evaluator_config_hash: args.configHash,
        response_hash: args.responseHash,
        score: args.outcome.score,
        value_number: args.outcome.value_number,
        value_string: args.outcome.value_string,
        value_boolean: args.outcome.value_boolean,
        value_raw_number: args.outcome.value_raw_number,
        reasoning: args.outcome.reasoning,
        original_cost_usd: args.outcome.original_cost_usd,
        original_tokens: args.outcome.original_tokens,
      },
      { onConflict: 'organization_id,evaluator_config_hash,response_hash', ignoreDuplicates: true },
    )
  } catch {
    // Cache writes must never break the caller. Drop and move on.
  }
}
