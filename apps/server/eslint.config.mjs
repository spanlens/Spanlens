import tsParser from '@typescript-eslint/parser'
import tsPlugin from '@typescript-eslint/eslint-plugin'
// `@spanlens/eslint-plugin` deliberately not in package.json. Adding it as a
// workspace dependency breaks Vercel deploys: vercel runs `npm install` from
// `apps/server/`, npm rejects `workspace:*` at package.json parse time, and
// switching to pnpm hits "Headless installation requires a pnpm-lock.yaml file"
// because the lockfile lives at the monorepo root. Pulling the plugin in via
// relative path keeps the server's install graph npm-compatible while still
// resolving for `pnpm --filter server lint` locally and in CI (where the
// plugin is built first by the dedicated `Build @spanlens/eslint-plugin`
// step in .github/workflows/ci.yml).
import spanlensPlugin from '../../packages/eslint-plugin/dist/index.js'
import globals from 'globals'

// `requests` holds every tenant's prompt and response text in one table, and
// the connection the server uses is the service role, which bypasses
// row-level security. Isolation is therefore entirely a property of the WHERE
// clause, and `lib/requests-query.ts` is the only place that guarantees one:
// `requestsScope` injects `organization_id` and the per-plan retention window
// into every read.
//
// A raw `pgQuery` call in an API handler is one forgotten predicate away from
// serving another customer's prompts. So the driver stays inside `lib/**`,
// where the helpers live, and route code goes through them.
const PG_MESSAGE =
  'Use the helpers in lib/requests-query.ts (selectRequests / countRequests / streamRequests) ' +
  'so the organization_id filter and plan retention window are applied. ' +
  'lib/postgres.ts is for lib/** internals only.'

const restrictedDbClients = {
  paths: [
    {
      name: '../lib/postgres.js',
      message: PG_MESSAGE,
    },
    {
      name: '../../lib/postgres.js',
      message: PG_MESSAGE,
    },
  ],
}

const config = [
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
      globals: {
        ...globals.node,
        ...globals.es2022,
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      '@spanlens': spanlensPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-restricted-imports': ['error', restrictedDbClients],
      // R-Q5: aes256Decrypt returns '' on every failure mode; missing
      // checks silently send empty Authorization headers upstream.
      '@spanlens/aes-decrypt-must-be-checked': 'error',
    },
  },
  {
    files: ['src/lib/**/*.ts', 'src/__tests__/**/*.ts'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
  {
    // The decrypt rule is for production code only. Test files
    // intentionally call aes256Decrypt() with malformed inputs and
    // assert the empty-string return — that IS the test.
    files: ['src/__tests__/**/*.ts'],
    rules: {
      '@spanlens/aes-decrypt-must-be-checked': 'off',
    },
  },
]

export default config
