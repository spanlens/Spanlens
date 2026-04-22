import { supabaseAdmin } from './db.js'
import {
  aggregate,
  type VersionMetrics,
  type PromptVersionRef,
  type RequestMetricRow,
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
  const windowStart = new Date(Date.now() - sinceHours * 3_600_000).toISOString()

  const { data: requests } = await supabaseAdmin
    .from('requests')
    .select('prompt_version_id, latency_ms, cost_usd, status_code, prompt_tokens, completion_tokens')
    .eq('organization_id', organizationId)
    .in('prompt_version_id', versionIds)
    .gte('created_at', windowStart)

  const byVersion = new Map<string, RequestMetricRow[]>()
  for (const r of ((requests ?? []) as RequestMetricRow[])) {
    if (!r.prompt_version_id) continue
    const bucket = byVersion.get(r.prompt_version_id) ?? []
    bucket.push(r)
    byVersion.set(r.prompt_version_id, bucket)
  }

  return typedVersions.map((v) => aggregate(v, byVersion.get(v.id) ?? []))
}
