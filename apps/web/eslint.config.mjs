import nextConfig from 'eslint-config-next/core-web-vitals'

const config = [
  ...nextConfig,
  {
    ignores: ['public/**', 'node_modules/**'],
  },
  {
    rules: {
      // App Router project — no pages/ directory, so this rule misfires on
      // internal links and would force unnecessary <Link> usage.
      '@next/next/no-html-link-for-pages': 'off',
    },
  },
]

export default config
