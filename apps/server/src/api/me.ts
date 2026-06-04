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

type KnownProvider = 'openai' | 'anthropic' | 'gemini' | 'azure'

const KNOWN_PROVIDERS: ReadonlySet<KnownProvider> = new Set([
  'openai', 'anthropic', 'gemini', 'azure',
])

interface KeyInfoResponse {
  /** Null for public (workspace-level) keys — they aren't tied to a single project. */
  projectId: string | null
  projectName: string | null
  /** Providers with an active provider_key under THIS Spanlens key. */
  providers: KnownProvider[]
  /** 'full' = can call proxy + ingest. 'public' = dashboard reads only. */
  scope: 'full' | 'public'
}

// GET /api/v1/me/key-info — introspect the presented Spanlens key.
// Returns enough info for the CLI to decide which provider integrations
// (OpenAI / Anthropic / Gemini) to auto-patch in the user's source.
//
// Under the nested-keys model, providers are scoped to this Spanlens key
// (api_key_id), NOT the project — two keys in the same project can return
// different provider lists.
//
// Internal path is `/` because the router is mounted at the full path
// (`/api/v1/me/key-info`) in app.ts. Mounting at the exact path avoids
// the wildcard-collision problem where evalsRouter/humanEvalsRouter, both
// mounted broadly at `/api/v1` with `.use('*', authJwt)`, were running
// their JWT gate first and rejecting `sl_live_*` keys with the misleading
// "Invalid or expired token" error.
meRouter.get('/', async (c) => {
  const projectId = c.get('projectId')
  const apiKeyId = c.get('apiKeyId')
  const scope = c.get('apiKeyScope')

  // Public keys are workspace-scoped — no owning project, no provider keys
  // attached. Skip both lookups for them and return a minimal response.
  if (!projectId) {
    return c.json({
      success: true,
      data: {
        projectId: null,
        projectName: null,
        providers: [],
        scope,
      } satisfies KeyInfoResponse,
    })
  }

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
  ).filter((p): p is KnownProvider => KNOWN_PROVIDERS.has(p as KnownProvider))

  const body: KeyInfoResponse = {
    projectId: project.id as string,
    projectName: project.name as string,
    providers,
    scope,
  }
  return c.json({ success: true, data: body })
})
