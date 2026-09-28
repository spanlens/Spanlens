/**
 * Connection settings for the integration suite, which runs against the
 * local Supabase stack that `supabase start` brings up.
 *
 * Shared by vitest.integration.config.ts (the env it injects into test
 * workers) and global-setup.ts (the admin client that seeds fixtures), so the
 * two cannot point at different databases.
 */

export const LOCAL_SUPABASE_URL = 'http://127.0.0.1:54321'

// Standard Supabase local dev credentials: identical for every local project,
// signed with the CLI's public demo JWT secret. Not secrets.
export const LOCAL_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
export const LOCAL_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

/**
 * lib/postgres.ts reads SUPABASE_DB_POOLER_URL. Production puts Supavisor's
 * transaction pooler there; the local stack has no pooler, so the suite talks
 * to the Postgres port the CLI publishes directly.
 */
export const LOCAL_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])
const ALLOW_REMOTE_FLAG = 'SPANLENS_INTEGRATION_ALLOW_REMOTE_DB'

type Env = Record<string, string | undefined>

/**
 * An explicit SUPABASE_DB_POOLER_URL wins, so a stack on non-default ports
 * works. It must still be local: the suite writes fixture rows, and a
 * production URL left exported in a shell would otherwise receive them. Set
 * SPANLENS_INTEGRATION_ALLOW_REMOTE_DB=1 to point at a disposable remote DB.
 *
 * Error messages never include the URL: it carries a password.
 */
export function resolveIntegrationDbUrl(env: Env): string {
  const explicit = env['SUPABASE_DB_POOLER_URL']
  if (!explicit) return LOCAL_DB_URL

  let host: string
  try {
    host = new URL(explicit).hostname
  } catch {
    throw new Error('SUPABASE_DB_POOLER_URL is not a valid connection URL')
  }

  if (!LOCAL_HOSTS.has(host) && env[ALLOW_REMOTE_FLAG] !== '1') {
    throw new Error(
      `SUPABASE_DB_POOLER_URL is not a local database. The integration suite inserts ` +
        `fixture rows, so it only runs against the local stack by default. Unset it to ` +
        `use ${LOCAL_DB_URL.replace(/:[^:@/]+@/, ':***@')}, or set ${ALLOW_REMOTE_FLAG}=1 ` +
        `for a disposable remote database.`,
    )
  }
  return explicit
}

/** The env the integration config injects into every test worker. */
export function integrationEnv(env: Env): Record<string, string> {
  return {
    SUPABASE_URL: LOCAL_SUPABASE_URL,
    SUPABASE_ANON_KEY: LOCAL_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: LOCAL_SERVICE_ROLE_KEY,
    SUPABASE_DB_POOLER_URL: resolveIntegrationDbUrl(env),
  }
}
