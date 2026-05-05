import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import { supabaseAdmin } from '../lib/db.js'
import { sha256Hex } from '../lib/crypto.js'

/**
 * Validates a Spanlens API key (sl_live_…) against `api_keys`.
 *
 * Each provider SDK uses a different transport for the key, so this
 * middleware accepts whichever shape the SDK sends — the proxy is
 * provider-agnostic at the auth layer:
 *
 *   • OpenAI SDK            → Authorization: Bearer sl_live_…
 *   • Anthropic SDK         → x-api-key: sl_live_…
 *   • Google Generative AI  → URL ?key=sl_live_…   (Google's standard)
 *
 * The first one found wins. After validation we put apiKeyId / projectId
 * / organizationId on the context for the proxy + logging layers.
 */
export type ApiKeyContext = {
  Variables: {
    organizationId: string
    projectId: string
    apiKeyId: string
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

  // 3. Google Generative AI SDK puts the key in ?key= (Google convention).
  //    Note: query-string keys leak into server access logs, but Google's
  //    SDK doesn't offer a header-based mode, so we follow their pattern.
  const queryKey = c.req.query('key')
  if (queryKey?.trim()) return queryKey.trim()

  return null
}

export const authApiKey = createMiddleware<ApiKeyContext>(async (c, next) => {
  const rawKey = extractApiKey(c)
  if (!rawKey) {
    return c.json(
      {
        error:
          'Missing API key. Pass sl_live_… via Authorization: Bearer (OpenAI SDK), x-api-key (Anthropic SDK), or ?key= (Google Generative AI SDK).',
      },
      401,
    )
  }

  const keyHash = await sha256Hex(rawKey)

  const { data, error } = await supabaseAdmin
    .from('api_keys')
    .select('id, project_id, projects(organization_id)')
    .eq('key_hash', keyHash)
    .eq('is_active', true)
    .single()

  if (error || !data) {
    return c.json({ error: 'Invalid API key' }, 401)
  }

  const project = data.projects as unknown as { organization_id: string } | null
  if (!project) {
    return c.json({ error: 'Project not found' }, 401)
  }

  c.set('apiKeyId', data.id as string)
  c.set('projectId', data.project_id as string)
  c.set('organizationId', project.organization_id)

  return next()
})
