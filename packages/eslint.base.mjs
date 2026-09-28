// Shared ESLint flat config for the packages published to npm
// (@spanlens/sdk, @spanlens/cli, @spanlens/mcp-server).
//
// Same baseline as apps/server/eslint.config.mjs: the typescript-eslint
// recommended rules without type information, so lint stays fast and needs no
// tsconfig project wiring. The parser, plugin and globals are root
// devDependencies because this file lives outside any one package.
//
// Each package's eslint.config.mjs calls packageConfig() and picks its own
// console policy, since "may this package write to stdout?" has a different
// answer for a library, a CLI wizard, and a stdio MCP server.

import tsParser from '@typescript-eslint/parser'
import tsPlugin from '@typescript-eslint/eslint-plugin'
import globals from 'globals'

/**
 * @param {{ consoleLevel: 'error' | 'warn' | 'off' }} options
 *   consoleLevel: severity for console.log/info/debug in src (warn and error
 *   are always allowed, since they go to stderr).
 * @returns {import('eslint').Linter.Config[]}
 */
export function packageConfig({ consoleLevel }) {
  return [
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
        'no-console': consoleLevel === 'off' ? 'off' : [consoleLevel, { allow: ['warn', 'error'] }],
        '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
        '@typescript-eslint/no-explicit-any': 'warn',
      },
    },
    {
      // Tests print diagnostics and build loosely typed fixtures on purpose.
      files: ['src/**/__tests__/**/*.ts', 'src/**/*.test.ts'],
      rules: {
        'no-console': 'off',
        '@typescript-eslint/no-explicit-any': 'off',
      },
    },
  ]
}
