/**
 * P3-16: compute a server-side distribution / sample summary at run completion.
 *
 * For typed configs that don't aggregate as a mean (CATEGORICAL, TEXT) the
 * dashboard had to either pull every per-sample row to build a histogram
 * client-side or show nothing. This helper produces a small jsonb the UI
 * reads in one shot. NUMERIC / legacy / embedding return null — their
 * avg_score + score_stddev already carry the summary.
 *
 * Pure + sync + dependency-free so it's trivially unit-testable.
 */

import type { TypedScoreConfig } from './judge-prompt.js'

/** A minimal projection of the scored sample shape the runner already has. */
export interface ScoredSampleForDistribution {
  value_number: number | null
  value_string: string | null
  value_boolean: boolean | null
}

/** Distribution shapes per data_type. The discriminant matches data_type
 *  one-for-one so the UI can switch on it without consulting the score_config. */
export type RunDistribution =
  | { type: 'categorical'; counts: Record<string, number> }
  | { type: 'boolean'; counts: { true: number; false: number } }
  | { type: 'text'; count: number; samples: string[] }

/** Max number of text samples kept on the run row. The full set is still in
 *  eval_results — this is just for an at-a-glance summary. */
const TEXT_SAMPLE_LIMIT = 10
/** Per-sample text truncation so a few long answers don't bloat the row. */
const TEXT_SAMPLE_MAX_CHARS = 240

/**
 * Build the distribution summary for a run. Returns null on score types that
 * are already summarised by avg_score (NUMERIC + legacy + embedding) so the
 * caller can simply pass it through to `eval_runs.distribution`.
 */
export function computeDistribution(
  scored: ScoredSampleForDistribution[],
  scoreConfig: TypedScoreConfig | null | undefined,
): RunDistribution | null {
  if (!scoreConfig) return null

  if (scoreConfig.data_type === 'CATEGORICAL') {
    // Counts keyed by the category string. Unknown / null are ignored —
    // parseJudgeReply already rejected anything not in the allow-list.
    const counts: Record<string, number> = {}
    for (const s of scored) {
      const v = s.value_string
      if (v == null) continue
      counts[v] = (counts[v] ?? 0) + 1
    }
    return { type: 'categorical', counts }
  }

  if (scoreConfig.data_type === 'BOOLEAN') {
    let t = 0
    let f = 0
    for (const s of scored) {
      if (s.value_boolean === true) t++
      else if (s.value_boolean === false) f++
    }
    return { type: 'boolean', counts: { true: t, false: f } }
  }

  if (scoreConfig.data_type === 'TEXT') {
    // Keep the first N non-empty samples, truncated, so the dashboard can show
    // representative answers without fetching the whole result set.
    const samples: string[] = []
    let count = 0
    for (const s of scored) {
      const v = s.value_string
      if (v == null || v.length === 0) continue
      count++
      if (samples.length < TEXT_SAMPLE_LIMIT) {
        samples.push(v.length > TEXT_SAMPLE_MAX_CHARS ? v.slice(0, TEXT_SAMPLE_MAX_CHARS) + '…' : v)
      }
    }
    return { type: 'text', count, samples }
  }

  // NUMERIC and unknown future types: avg_score + score_stddev already cover it.
  return null
}
