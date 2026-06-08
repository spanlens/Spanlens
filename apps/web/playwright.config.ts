import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright configuration for the Spanlens E2E smoke suite.
 *
 * Scope: a single browser (chromium), a single project, a single browser
 * profile. We deliberately do NOT spread across firefox/webkit here —
 * the smoke test exercises proxy + dashboard read paths that are
 * server-mediated, so browser-engine differences would mostly add CI
 * minutes without raising signal.
 *
 * `webServer`: we do NOT auto-spawn `pnpm dev` here. Local devs run
 * `docker compose -f docker-compose.dev.yml up -d` + `pnpm dev` in two
 * terminals; CI's e2e workflow does the same wiring explicitly. Letting
 * Playwright spawn the dev server hides ordering bugs (e.g. server
 * starting before Postgres is ready).
 *
 * Retries: 1 on CI to absorb the occasional flake from the Vercel deploy
 * + ClickHouse insert eventual-consistency window. 0 locally so a
 * regression doesn't get masked.
 */
export default defineConfig({
  testDir: './__e2e__',
  fullyParallel: false, // smoke tests share a single Supabase auth fixture; keep sequential
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  workers: 1,
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env['E2E_BASE_URL'] ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: process.env['CI'] ? 'retain-on-failure' : 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Generous overall timeout — the smoke flow waits for ClickHouse
  // insert propagation (a few seconds in dev, can be ~10s on a cold CI
  // ClickHouse container).
  timeout: 60_000,
  expect: {
    timeout: 15_000,
  },
})
