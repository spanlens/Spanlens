import tsParser from '@typescript-eslint/parser'
import tsPlugin from '@typescript-eslint/eslint-plugin'
import spanlensPlugin from '@spanlens/eslint-plugin'
import globals from 'globals'

const restrictedClickhouse = {
  paths: [
    {
      name: '../lib/clickhouse.js',
      importNames: ['getClickhouse'],
      message:
        'Use getOrgClickhouse(orgId) from lib/clickhouse.ts or the helpers in lib/requests-query.ts instead of getClickhouse() directly.',
    },
    {
      name: '../../lib/clickhouse.js',
      importNames: ['getClickhouse'],
      message:
        'Use getOrgClickhouse(orgId) from lib/clickhouse.ts or the helpers in lib/requests-query.ts instead of getClickhouse() directly.',
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
