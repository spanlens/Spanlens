import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import { supabaseAdmin } from '../lib/db.js'
import { sha256Hex } from '../lib/crypto.js'

/**
 * Validates a Spanlens API key (sl_live_* or sl_live_pub_*) against `api_keys`.
 *
 * Each provider SDK uses a different transport for the key, so this
 * middleware accepts whichever shape the SDK sends — the proxy is
 * provider-agnostic at the auth layer:
 *
 *   • OpenAI SDK            → Authorization: Bearer sl_live_…
 *   • Anthropic SDK         → x-api-key: sl_live_…
 *   • Google Generative AI  → x-goog-api-key: sl_live_…
 *
 * The first one found wins. After validation we put apiKeyId, scope, and
 * organizationId on the context. `projectId` is set ONLY for `full` keys —
 * `public` keys are workspace-scoped and have no single owning project.
 *
 * Note: ?key= query-string transport was removed (security: keys leak into
 * server access logs, browser history, and Referer headers). All current
 * Google Generative AI SDK versions use the x-goog-api-key header.
 */
export type ApiKeyScope = 'full' | 'public'

export type ApiKeyContext = {
  Variables: {
    organizationId: string
    /** Always present for `full` scope; null for `public` (workspace-level) keys. */
    projectId: string | null
    apiKeyId: string
    apiKeyScope: ApiKeyScope
  }
}

/** Pull the Spanlens key out of the request, regardless of which SDK sent it. */
function extractApiKey(c: Context): string | null {
  // 1. OpenAI / generic Bearer auth
  const authHeader = c.req.header('Authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const key = authHeader.slice(7).trim()
    if (key) return key
  }

  // 2. Anthropic SDK
  const xApiKey = c.req.header('x-api-key')
  if (xApiKey?.trim()) return xApiKey.trim()

  // 3. Google Generative AI SDK (current versions) — header form.
  //    Verified against @google/generative-ai dist source: requests carry
  //    `x-goog-api-key: <apiKey>` (and `x-goog-api-client` for telemetry).
  const xGoogKey = c.req.header('x-goog-api-key')
  if (xGoogKey?.trim()) return xGoogKey.trim()

  return null
}

export const authApiKey = createMiddleware<ApiKeyContext>(async (c, next) => {
  const rawKey = extractApiKey(c)
  if (!rawKey) {
    return c.json(
      {
        error:
          'Missing API key. Pass sl_live_… via Authorization: Bearer (OpenAI SDK), x-api-key (Anthropic SDK), or x-goog-api-key (Google Generative AI SDK).',
      },
      401,
    )
  }

  const keyHash = await sha256Hex(rawKey)

  // Select both ownership columns + scope. The CHECK constraint in the
  // migration guarantees exactly one of (project_id, organization_id) is
  // non-null, so we can branch on scope without defensive validation.
  const { data, error } = await supabaseAdmin
    .from('api_keys')
    .select('id, project_id, organization_id, scope, projects(organization_id)')
    .eq('key_hash', keyHash)
    .eq('is_active', true)
    .single()

  if (error || !data) {
    return c.json({ error: 'Invalid API key' }, 401)
  }

  const scope: ApiKeyScope = (data.scope as string) === 'public' ? 'public' : 'full'

  // Resolve organizationId based on scope:
  //   full   → from projects join (api_keys.project_id → projects.organization_id)
  //   public → directly from api_keys.organization_id
  let organizationId: string | null = null
  if (scope === 'full') {
    const project = data.projects as unknown as { organization_id: string } | null
    organizationId = project?.organization_id ?? null
  } else {
    organizationId = (data.organization_id as string | null) ?? null
  }

  if (!organizationId) {
    return c.json({ error: 'API key has no owning organization' }, 401)
  }

  c.set('apiKeyId', data.id as string)
  c.set('apiKeyScope', scope)
  c.set('organizationId', organizationId)
  c.set('projectId', (data.project_id as string | null) ?? null)

  return next()
})
