import { supabaseAdmin } from './db.js'
import { requestsScope, selectRequests } from './requests-query.js'
import {
  aggregate,
  type VersionMetrics,
  type PromptVersionRef,
  type RequestMetricRow,
  type QualityAggregate,
} from './prompt-compare-stats.js'

/**
 * Aggregate per-version metrics for a named prompt.
 *
 * For each version, computes: sample_count, avg_latency_ms, error_rate,
 * avg_cost_usd, total_cost_usd, avg_prompt_tokens, avg_completion_tokens.
 * Returns sorted by version (asc).
 */

export type { VersionMetrics }

export async function comparePromptVersions(
  organizationId: string,
  name: string,
  options: { sinceHours?: number } = {},
): Promise<VersionMetrics[]> {
  const sinceHours = options.sinceHours ?? 24 * 30 // default 30 days

  const { data: versions } = await supabaseAdmin
    .from('prompt_versions')
    .select('id, version, created_at')
    .eq('organization_id', organizationId)
    .eq('name', name)
    .order('version', { ascending: true })

  const typedVersions = (versions ?? []) as PromptVersionRef[]
  if (typedVersions.length === 0) return []

  const versionIds = typedVersions.map((v) => v.id)
  const windowStart = new Date(Date.now() - sinceHours * 3_600_000)
    .toISOString()
    .replace('T', ' ')
    .replace('Z', '')

  // User-facing analytical query — plan retention applies. cost_usd arrives as
  // a string from ClickHouse (Decimal); aggregator coerces it.
  interface PromptCompareRow {
    prompt_version_id: string | null
    latency_ms: number
    cost_usd: string | number | null
    status_code: number
    prompt_tokens: number
    completion_tokens: number
  }
  const scope = await requestsScope(organizationId)
  const rawRequests = await selectRequests<PromptCompareRow>({
    scope,
    select:
      'prompt_version_id, latency_ms, cost_usd, status_code, prompt_tokens, completion_tokens',
    filters:
      'prompt_version_id IN {versionIds:Array(UUID)} ' +
      'AND created_at >= parseDateTime64BestEffort({windowStart:String})',
    params: { versionIds, windowStart },
  })

  const byVersion = new Map<string, RequestMetricRow[]>()
  for (const r of rawRequests) {
    if (!r.prompt_version_id) continue
    const normalized: RequestMetricRow = {
      prompt_version_id: r.prompt_version_id,
      latency_ms: r.latency_ms,
      cost_usd: r.cost_usd == null ? null : Number(r.cost_usd),
      status_code: r.status_code,
      prompt_tokens: r.prompt_tokens,
      completion_tokens: r.completion_tokens,
    }
    const bucket = byVersion.get(r.prompt_version_id) ?? []
    bucket.push(normalized)
    byVersion.set(r.prompt_version_id, bucket)
  }

  // Aggregate eval_results scores per prompt version (LLM-as-judge quality).
  // Joined here so calls-tab QUALITY column can display real values.
  const { data: evalRows } = await supabaseAdmin
    .from('eval_runs')
    .select('prompt_version_id, eval_results ( score )')
    .eq('organization_id', organizationId)
    .in('prompt_version_id', versionIds)
    .eq('status', 'completed')

  type EvalRunRow = {
    prompt_version_id: string | null
    eval_results: Array<{ score: number | null }> | { score: number | null } | null
  }
  const qualityByVersion = new Map<string, QualityAggregate>()
  for (const row of (evalRows ?? []) as unknown as EvalRunRow[]) {
    if (!row.prompt_version_id) continue
    const results = Array.isArray(row.eval_results)
      ? row.eval_results
      : row.eval_results ? [row.eval_results] : []
    const agg = qualityByVersion.get(row.prompt_version_id) ?? { scoreSum: 0, count: 0 }
    for (const r of results) {
      if (typeof r.score === 'number') {
        agg.scoreSum += r.score
        agg.count += 1
      }
    }
    qualityByVersion.set(row.prompt_version_id, agg)
  }

  return typedVersions.map((v) =>
    aggregate(v, byVersion.get(v.id) ?? [], qualityByVersion.get(v.id)),
  )
}
