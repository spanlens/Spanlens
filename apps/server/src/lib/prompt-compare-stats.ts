/**
 * Pure aggregation helper for prompt version metrics.
 * Split from prompt-compare.ts so tests can import without tripping
 * Supabase env checks via the db.ts transitive import.
 */

export interface VersionMetrics {
  version: number
  promptVersionId: string
  createdAt: string
  sampleCount: number
  avgLatencyMs: number
  errorRate: number
  avgCostUsd: number
  totalCostUsd: number
  avgPromptTokens: number
  avgCompletionTokens: number
  /** Average score from eval_results for this prompt version (0..1). Null if no evals run yet. */
  avgQualityScore: number | null
  /** Number of eval_results rows aggregated into avgQualityScore. */
  qualitySampleCount: number
}

export interface PromptVersionRef {
  id: string
  version: number
  created_at: string
}

export interface RequestMetricRow {
  prompt_version_id: string | null
  latency_ms: number | null
  cost_usd: number | null
  status_code: number | null
  prompt_tokens: number | null
  completion_tokens: number | null
}

export interface QualityAggregate {
  /** Sum of normalized scores (0..1) for this prompt version's eval_results. */
  scoreSum: number
  /** Number of eval_results rows. */
  count: number
}

export function aggregate(
  version: PromptVersionRef,
  rows: readonly RequestMetricRow[],
  quality?: QualityAggregate,
): VersionMetrics {
  const n = rows.length
  const qualityCount = quality?.count ?? 0
  const avgQuality = qualityCount > 0 && quality ? quality.scoreSum / qualityCount : null

  if (n === 0) {
    return {
      version: version.version,
      promptVersionId: version.id,
      createdAt: version.created_at,
      sampleCount: 0,
      avgLatencyMs: 0,
      errorRate: 0,
      avgCostUsd: 0,
      totalCostUsd: 0,
      avgPromptTokens: 0,
      avgCompletionTokens: 0,
      avgQualityScore: avgQuality,
      qualitySampleCount: qualityCount,
    }
  }

  let latencySum = 0
  let latencyCount = 0
  let costSum = 0
  let costCount = 0
  let errorCount = 0
  let promptTokenSum = 0
  let promptTokenCount = 0
  let completionTokenSum = 0
  let completionTokenCount = 0

  for (const r of rows) {
    if (typeof r.latency_ms === 'number') {
      latencySum += r.latency_ms
      latencyCount += 1
    }
    if (typeof r.cost_usd === 'number') {
      costSum += r.cost_usd
      costCount += 1
    }
    if (typeof r.status_code === 'number' && r.status_code >= 400) errorCount += 1
    if (typeof r.prompt_tokens === 'number') {
      promptTokenSum += r.prompt_tokens
      promptTokenCount += 1
    }
    if (typeof r.completion_tokens === 'number') {
      completionTokenSum += r.completion_tokens
      completionTokenCount += 1
    }
  }

  return {
    version: version.version,
    promptVersionId: version.id,
    createdAt: version.created_at,
    sampleCount: n,
    avgLatencyMs: latencyCount > 0 ? latencySum / latencyCount : 0,
    errorRate: errorCount / n,
    avgCostUsd: costCount > 0 ? costSum / costCount : 0,
    totalCostUsd: costSum,
    avgPromptTokens: promptTokenCount > 0 ? promptTokenSum / promptTokenCount : 0,
    avgCompletionTokens: completionTokenCount > 0 ? completionTokenSum / completionTokenCount : 0,
    avgQualityScore: avgQuality,
    qualitySampleCount: qualityCount,
  }
}
