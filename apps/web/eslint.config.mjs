import nextConfig from 'eslint-config-next/core-web-vitals'

const config = [
  ...nextConfig,
  {
    ignores: ['public/**', 'node_modules/**'],
  },
  {
    rules: {
      // New strict rules from eslint-plugin-react-hooks 7.x. Existing code
      // predates them; address in a follow-up to keep the dep upgrade focused.
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/use-memo': 'off',
      'react-hooks/exhaustive-deps': 'warn',
      // App Router project — no pages/ directory, so this rule misfires on
      // internal links and would force unnecessary <Link> usage.
      '@next/next/no-html-link-for-pages': 'off',
    },
  },
]

export default config
