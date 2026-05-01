import { createMiddleware } from 'hono/factory'
import { supabaseAdmin } from '../lib/db.js'
import { sha256Hex } from '../lib/crypto.js'

export type ApiKeyContext = {
  Variables: {
    organizationId: string
    projectId: string
    apiKeyId: string
    providerKeyId: string | null
  }
}

export const authApiKey = createMiddleware<ApiKeyContext>(async (c, next) => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid Authorization header' }, 401)
  }

  const rawKey = authHeader.slice(7)
  const keyHash = await sha256Hex(rawKey)

  const { data, error } = await supabaseAdmin
    .from('api_keys')
    .select('id, project_id, provider_key_id, projects(organization_id)')
    .eq('key_hash', keyHash)
    .eq('is_active', true)
    .single()

  if (error || !data) {
    return c.json({ error: 'Invalid API key' }, 401)
  }

  const project = (data.projects as unknown as { organization_id: string } | null)
  if (!project) {
    return c.json({ error: 'Project not found' }, 401)
  }

  c.set('apiKeyId', data.id as string)
  c.set('projectId', data.project_id as string)
  c.set('organizationId', project.organization_id)
  c.set('providerKeyId', (data.provider_key_id as string | null) ?? null)

  return next()
})
