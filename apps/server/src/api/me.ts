import { Hono } from 'hono'
import { authApiKey, type ApiKeyContext } from '../middleware/authApiKey.js'
import { supabaseAdmin } from '../lib/db.js'

/**
 * Endpoints that introspect the *Spanlens API key* presented in the
 * Authorization header (NOT the user JWT). Used by `npx @spanlens/cli init`
 * and other tooling that runs outside the browser.
 *
 * Why authApiKey: the CLI runs on the user's laptop and only has the
 * `sl_live_*` they just pasted — it has no Supabase session.
 */
export const meRouter = new Hono<ApiKeyContext>()

meRouter.use('*', authApiKey)

interface KeyInfoResponse {
  projectId: string
  projectName: string
  /** Providers with an active provider_key under THIS Spanlens key. */
  providers: Array<'openai' | 'anthropic' | 'gemini'>
}

// GET /api/v1/me/key-info — introspect the presented Spanlens key.
// Returns enough info for the CLI to decide which provider integrations
// (OpenAI / Anthropic / Gemini) to auto-patch in the user's source.
//
// Under the nested-keys model, providers are scoped to this Spanlens key
// (api_key_id), NOT the project — two keys in the same project can return
// different provider lists.
meRouter.get('/key-info', async (c) => {
  const projectId = c.get('projectId')
  const apiKeyId = c.get('apiKeyId')

  const [{ data: project }, { data: providerKeys }] = await Promise.all([
    supabaseAdmin
      .from('projects')
      .select('id, name')
      .eq('id', projectId)
      .single(),
    supabaseAdmin
      .from('provider_keys')
      .select('provider')
      .eq('api_key_id', apiKeyId)
      .eq('is_active', true),
  ])

  if (!project) return c.json({ error: 'Project not found' }, 404)

  const providers = Array.from(
    new Set((providerKeys ?? []).map((row) => row.provider as string)),
  ).filter((p): p is 'openai' | 'anthropic' | 'gemini' =>
    p === 'openai' || p === 'anthropic' || p === 'gemini',
  )

  const body: KeyInfoResponse = {
    projectId: project.id as string,
    projectName: project.name as string,
    providers,
  }
  return c.json({ success: true, data: body })
})
