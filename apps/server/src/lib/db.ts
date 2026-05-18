import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// Lazy initialisation — clients are created on first use, not at module load.
//
// Rationale: a module-level throw crashes ALL requests (including favicon,
// health-check, robots.txt) on any deployment where Supabase env vars are
// absent — e.g. Dependabot preview deployments or self-hosted setups that
// only use the proxy.  Moving the check inside a factory ensures the error
// only surfaces when Supabase is actually needed.
// ---------------------------------------------------------------------------

let _admin: SupabaseClient | null = null
let _client: SupabaseClient | null = null

function initClients(): { admin: SupabaseClient; client: SupabaseClient } {
  if (_admin && _client) return { admin: _admin, client: _client }

  const url = process.env.SUPABASE_URL
  const anonKey = process.env.SUPABASE_ANON_KEY
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !anonKey || !serviceRoleKey) {
    const missing = [
      !url && 'SUPABASE_URL',
      !anonKey && 'SUPABASE_ANON_KEY',
      !serviceRoleKey && 'SUPABASE_SERVICE_ROLE_KEY',
    ].filter(Boolean).join(', ')
    throw new Error(
      `Missing required Supabase environment variables: ${missing}. ` +
      `See https://spanlens.io/docs/self-host for setup.`,
    )
  }

  _admin = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  _client = createClient(url, anonKey)

  return { admin: _admin, client: _client }
}

// Proxy exports preserve the existing import surface (`supabaseAdmin`,
// `supabaseClient`) while deferring env-var validation to first use.
export const supabaseAdmin = new Proxy({} as SupabaseClient, {
  get(_target, prop: string | symbol) {
    return Reflect.get(initClients().admin, prop)
  },
})

export const supabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop: string | symbol) {
    return Reflect.get(initClients().client, prop)
  },
})
