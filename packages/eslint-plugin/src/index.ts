import { aesDecryptMustBeChecked } from './rules/aes-decrypt-must-be-checked.js'

/**
 * @spanlens/eslint-plugin — internal ESLint rules.
 *
 * Each rule guards a silent-data-loss pattern the TypeScript type system
 * cannot catch on its own. See RULES.md for the per-rule rationale.
 */
const plugin = {
  meta: {
    name: '@spanlens/eslint-plugin',
    version: '0.0.1',
  },
  rules: {
    'aes-decrypt-must-be-checked': aesDecryptMustBeChecked,
  },
}

export default plugin
export const rules = plugin.rules
