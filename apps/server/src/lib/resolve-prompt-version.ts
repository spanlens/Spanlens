import { supabaseAdmin } from './db.js'

/**
 * Resolve the X-Spanlens-Prompt-Version header value into a prompt_versions.id UUID.
 *
 * Accepted formats:
 *   "<uuid>"              → treated as a direct id; we verify it exists & belongs to this org
 *   "<name>@<version>"    → looks up by (organization_id, name, version)
 *   "<name>@latest"       → looks up the highest version for that name
 *   "" / undefined / null → returns null immediately
 *
 * Returns null on any lookup miss or validation failure — we never block the
 * proxy request because the prompt version tag is malformed or stale. The
 * `requests` row simply won't be linked, and the A/B comparison will show
 * fewer samples. Failure mode: telemetry degradation, not user-visible error.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function resolvePromptVersion(
  organizationId: string,
  header: string | null | undefined,
): Promise<string | null> {
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
    return data?.id ?? null
  }

  // Format 2: name@version
  const atIdx = trimmed.lastIndexOf('@')
  if (atIdx < 1) return null

  const name = trimmed.slice(0, atIdx)
  const versionPart = trimmed.slice(atIdx + 1)
  if (!name) return null

  // name@latest
  if (versionPart === 'latest') {
    const { data } = await supabaseAdmin
      .from('prompt_versions')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('name', name)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle()
    return data?.id ?? null
  }

  // name@<n>
  const version = Number(versionPart)
  if (!Number.isInteger(version) || version < 1) return null

  const { data } = await supabaseAdmin
    .from('prompt_versions')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('name', name)
    .eq('version', version)
    .maybeSingle()
  return data?.id ?? null
}
