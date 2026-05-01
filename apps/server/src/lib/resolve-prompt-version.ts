import { supabaseAdmin } from './db.js'
import { routeExperimentTraffic } from './prompt-traffic-routing.js'

/**
 * Resolve the X-Spanlens-Prompt-Version header value into a prompt_versions.id UUID.
 *
 * Accepted formats:
 *   "<uuid>"              → treated as a direct id; we verify it exists & belongs to this org
 *   "<name>@<version>"    → looks up by (organization_id, name, version)
 *   "<name>@latest"       → looks up the highest version for that name
 *                           *** If there is a running A/B experiment for this prompt,
 *                               traffic is routed deterministically to version_a or version_b
 *                               using SHA-256(traceId + experimentId) % 100.
 *   "" / undefined / null → returns null immediately
 *
 * Returns null on any lookup miss or validation failure — we never block the
 * proxy request because the prompt version tag is malformed or stale.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface ResolvedPromptVersion {
  versionId: string
  /** Set when the request was routed via a running A/B experiment */
  experimentId?: string
  /** Which arm of the experiment this request was assigned to */
  experimentArm?: 'a' | 'b'
}

export async function resolvePromptVersion(
  organizationId: string,
  header: string | null | undefined,
  /** traceId from x-trace-id header — used for deterministic A/B routing */
  traceId?: string | null,
): Promise<ResolvedPromptVersion | null> {
  if (!header) return null

  const trimmed = header.trim()
  if (!trimmed) return null

  // Format 1: raw UUID
  if (UUID_RE.test(trimmed)) {
    const { data } = await supabaseAdmin
      .from('prompt_versions')
      .select('id')
      .eq('id', trimmed)
      .eq('organization_id', organizationId)
      .maybeSingle()
    return data ? { versionId: data.id } : null
  }

  // Format 2: name@version
  const atIdx = trimmed.lastIndexOf('@')
  if (atIdx < 1) return null

  const name = trimmed.slice(0, atIdx)
  const versionPart = trimmed.slice(atIdx + 1)
  if (!name) return null

  // name@<n> — explicit version always bypasses A/B
  if (versionPart !== 'latest') {
    const version = Number(versionPart)
    if (!Number.isInteger(version) || version < 1) return null

    const { data } = await supabaseAdmin
      .from('prompt_versions')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('name', name)
      .eq('version', version)
      .maybeSingle()
    return data ? { versionId: data.id } : null
  }

  // name@latest — check for a running A/B experiment first
  const { data: experiment } = await supabaseAdmin
    .from('prompt_ab_experiments')
    .select('id, version_a_id, version_b_id, traffic_split')
    .eq('organization_id', organizationId)
    .eq('prompt_name', name)
    .eq('status', 'running')
    .maybeSingle()

  if (experiment) {
    const arm = await routeExperimentTraffic(traceId, experiment.id, experiment.traffic_split)
    const versionId = arm === 'a' ? experiment.version_a_id : experiment.version_b_id
    return { versionId, experimentId: experiment.id, experimentArm: arm }
  }

  // No experiment running — resolve to the latest version
  const { data } = await supabaseAdmin
    .from('prompt_versions')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('name', name)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data ? { versionId: data.id } : null
}
