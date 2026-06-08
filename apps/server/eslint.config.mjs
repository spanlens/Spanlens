import tsParser from '@typescript-eslint/parser'
import tsPlugin from '@typescript-eslint/eslint-plugin'
import spanlensPlugin from '@spanlens/eslint-plugin'
import globals from 'globals'

// R-Q6: `unscopedClickhouse` (renamed from `getClickhouse`) returns the
// raw ClickHouse client with no organization scoping. Importing it from
// API/middleware code is a cross-tenant leak waiting to happen because
// ClickHouse has no row-level security; every read MUST filter on
// organization_id at the application layer. The org-scoped helpers in
// `lib/requests-query.ts` / `lib/events-query.ts` (and `getOrgClickhouse`)
// thread the org id through automatically.
//
// The block targets both the function name and the legacy alias so a
// pre-R-Q6 stash that still says `getClickhouse` is also rejected — the
// alias does not exist anymore, but a stale auto-import in someone's
// editor could try to add it back, and the explicit message is clearer
// than a "module not found" error.
const restrictedClickhouse = {
  paths: [
    {
      name: '../lib/clickhouse.js',
      importNames: ['unscopedClickhouse', 'getClickhouse'],
      message:
        'Use getOrgClickhouse(orgId) from lib/clickhouse.ts (or the helpers in lib/requests-query.ts / lib/events-query.ts) instead. For health checks use pingClickhouse(). unscopedClickhouse() is for lib/** internals only.',
    },
    {
      name: '../../lib/clickhouse.js',
      importNames: ['unscopedClickhouse', 'getClickhouse'],
      message:
        'Use getOrgClickhouse(orgId) from lib/clickhouse.ts (or the helpers in lib/requests-query.ts / lib/events-query.ts) instead. For health checks use pingClickhouse(). unscopedClickhouse() is for lib/** internals only.',
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
      'no-restricted-imports': ['error', restrictedClickhouse],
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
