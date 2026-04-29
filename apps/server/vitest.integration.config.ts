import { defineConfig } from 'vitest/config'

// Integration tests run against a real local Supabase instance.
// Requires: supabase start
//
// Run: pnpm --filter server test:integration

const LOCAL_URL = 'http://127.0.0.1:54321'
// Standard Supabase local dev credentials — identical for all local projects.
const LOCAL_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const LOCAL_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

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
    // Inject local Supabase credentials so lib/db.ts connects to the local instance
    env: {
      SUPABASE_URL: LOCAL_URL,
      SUPABASE_ANON_KEY: LOCAL_ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: LOCAL_SERVICE_ROLE_KEY,
    },
  },
})
