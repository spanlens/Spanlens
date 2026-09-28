import { defineConfig } from 'vitest/config'
import { integrationEnv } from './src/__tests__/integration/local-stack'

// Integration tests run against a real local Supabase instance.
// Requires: `supabase start` (or `pnpm db:local`), then
//
//   pnpm --filter server test:integration
//
// No env vars are needed. The database URL defaults to the local stack's
// direct Postgres port; an explicit SUPABASE_DB_POOLER_URL overrides it but
// must be local unless SPANLENS_INTEGRATION_ALLOW_REMOTE_DB=1. See
// src/__tests__/integration/local-stack.ts. CI runs this suite right after
// `supabase db reset` in .github/workflows/ci.yml.

export default defineConfig({
  test: {
    include: ['src/__tests__/integration/**/*.test.ts'],
    environment: 'node',
    globals: true,
    globalSetup: ['src/__tests__/integration/global-setup.ts'],
    // Sequential execution — tests share DB state via fixtures
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Point lib/db.ts and lib/postgres.ts at the local instance.
    env: integrationEnv(process.env),
  },
})
