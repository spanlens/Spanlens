import tsParser from '@typescript-eslint/parser'
import tsPlugin from '@typescript-eslint/eslint-plugin'
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
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-restricted-imports': ['error', restrictedClickhouse],
    },
  },
  {
    files: ['src/lib/**/*.ts', 'src/__tests__/**/*.ts'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
]

export default config
