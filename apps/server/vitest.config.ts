import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    exclude: ['**/node_modules/**', '**/integration/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      // Ratchet threshold — set just below the current baseline (P2.3 measured
      // 17.94% lines) so this run passes, and any future PR that drops
      // coverage fails locally with `pnpm test --coverage`. CI runs `pnpm test`
      // without the coverage flag, so this only gates opt-in measurement.
      // Bump the floor each PR that adds meaningful coverage; the master
      // plan's P2.3 target is 80% on Tier 1 modules. See
      // docs/plans/launch-readiness-master-plan.md.
      thresholds: { lines: 17 },
    },
  },
})
