import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import {
  LOCAL_DB_URL,
  integrationEnv,
  resolveIntegrationDbUrl,
} from './integration/local-stack.js'

/**
 * The integration suite talks to a real Postgres through lib/postgres.ts, which
 * throws when SUPABASE_DB_POOLER_URL is unset. vitest does not load .env, so
 * `pnpm --filter server test:integration` used to fail on a fresh checkout
 * with "SUPABASE_DB_POOLER_URL is not configured" unless the caller knew to
 * export it. CI never ran the suite at all.
 */
describe('integration suite database URL', () => {
  test('the injected env carries a database URL without any shell env', () => {
    expect(integrationEnv({})['SUPABASE_DB_POOLER_URL']).toBe(LOCAL_DB_URL)
  })

  test('vitest.integration.config.ts builds its env from integrationEnv()', () => {
    // Read as text: the config sits outside tsconfig's rootDir, so importing it
    // here would break `tsc --noEmit`.
    const configPath = fileURLToPath(new URL('../../vitest.integration.config.ts', import.meta.url))
    const source = readFileSync(configPath, 'utf8')
    expect(source).toMatch(/env:\s*integrationEnv\(process\.env\)/)
  })

  test('defaults to the direct connection of the local Supabase stack', () => {
    // There is no Supavisor in front of the local stack, so the "pooler" URL
    // is the plain Postgres port the CLI publishes.
    expect(resolveIntegrationDbUrl({})).toBe(LOCAL_DB_URL)
    expect(LOCAL_DB_URL).toBe('postgresql://postgres:postgres@127.0.0.1:54322/postgres')
  })

  test('an explicit local URL wins over the default', () => {
    const url = 'postgresql://postgres:postgres@localhost:6543/postgres'
    expect(resolveIntegrationDbUrl({ SUPABASE_DB_POOLER_URL: url })).toBe(url)
  })

  test('an empty value falls back to the default instead of failing later', () => {
    expect(resolveIntegrationDbUrl({ SUPABASE_DB_POOLER_URL: '' })).toBe(LOCAL_DB_URL)
  })

  test('refuses a remote database unless explicitly allowed', () => {
    // The suite inserts fixture rows. A production pooler URL left exported in
    // a shell must not turn a test run into writes against customer data.
    const remote = 'postgresql://postgres.ref:pw@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres'
    expect(() => resolveIntegrationDbUrl({ SUPABASE_DB_POOLER_URL: remote })).toThrow(/not a local database/)
    expect(
      resolveIntegrationDbUrl({
        SUPABASE_DB_POOLER_URL: remote,
        SPANLENS_INTEGRATION_ALLOW_REMOTE_DB: '1',
      }),
    ).toBe(remote)
  })

  test('the refusal does not echo the connection string', () => {
    const remote = 'postgresql://postgres.ref:s3cret-pw@db.example.com:6543/postgres'
    try {
      resolveIntegrationDbUrl({ SUPABASE_DB_POOLER_URL: remote })
      expect.unreachable('should have thrown')
    } catch (err) {
      expect(String(err)).not.toContain('s3cret-pw')
      expect(String(err)).not.toContain('db.example.com')
    }
  })

  test('rejects a value that is not a URL', () => {
    expect(() => resolveIntegrationDbUrl({ SUPABASE_DB_POOLER_URL: 'not a url' })).toThrow(/not a valid/)
  })
})
