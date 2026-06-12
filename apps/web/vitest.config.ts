import { defineConfig } from 'vitest/config'
import path from 'node:path'

// tsconfig.json has `jsx: preserve` so Next.js's compiler can handle JSX. The
// app code never imports React explicitly because Next sets the automatic
// runtime at build time. Vitest uses esbuild instead of the Next compiler, so
// we mirror the automatic runtime here — without it, JSX expands to
// `React.createElement(...)` and component tests fail with "React is not
// defined".

// Vitest configuration for apps/web.
//
// Two test environments are configured here, distinguished by file location
// + naming convention so the right environment loads automatically:
//
//   - lib/**/*.test.ts(x)         → node env. Pure helpers (formatters, PII
//                                   masking, query-string utils). Faster
//                                   startup; no DOM globals.
//   - components/**/*.test.tsx    → jsdom env (via per-file pragma). React
//                                   component tests using @testing-library/
//                                   react. Pragma is at the top of each
//                                   component test file:
//                                       // @vitest-environment jsdom
//
// Why a pragma instead of forking config: Vitest 3 supports only a single
// `environment` option per project. Splitting into two projects is heavier
// than this needs. The pragma is the documented escape hatch and lets new
// component tests opt in without config edits.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: [
      'lib/**/*.test.ts',
      'lib/**/*.test.tsx',
      'components/**/*.test.ts',
      'components/**/*.test.tsx',
    ],
    exclude: ['**/node_modules/**', '__e2e__/**', '.next/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname),
    },
  },
  esbuild: {
    jsx: 'automatic',
  },
})
