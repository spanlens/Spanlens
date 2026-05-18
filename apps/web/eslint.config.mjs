import nextConfig from 'eslint-config-next/core-web-vitals'

// Non-essential analytics / marketing SDKs that require opt-in cookie consent
// under GDPR / ePrivacy before they may load. Blocking imports at lint time
// prevents an accidental "just drop in PostHog" PR from shipping without
// first wiring up `isAnalyticsAllowed()` from `@/lib/cookie-consent` and
// enabling the consent banner.
//
// To allow a package below: add a per-file ESLint override that confirms it
// runs only after consent is granted, then leave a comment pointing at the
// gate code. Better yet, write the gate code in a single util the analytics
// SDK is initialized from.
const RESTRICTED_ANALYTICS_IMPORTS = {
  paths: [
    { name: 'posthog-js', message: 'Gate behind isAnalyticsAllowed() and enable the consent banner first. See lib/cookie-consent.ts.' },
    { name: 'posthog-js/react', message: 'Gate behind isAnalyticsAllowed() and enable the consent banner first.' },
    { name: 'mixpanel-browser', message: 'Gate behind isAnalyticsAllowed() and enable the consent banner first.' },
    { name: '@amplitude/analytics-browser', message: 'Gate behind isAnalyticsAllowed() and enable the consent banner first.' },
    { name: '@segment/analytics-next', message: 'Gate behind isAnalyticsAllowed() and enable the consent banner first.' },
    { name: 'plausible-tracker', message: 'Gate behind isAnalyticsAllowed() and enable the consent banner first.' },
    { name: 'react-ga', message: 'Gate behind isAnalyticsAllowed() and enable the consent banner first.' },
    { name: 'react-ga4', message: 'Gate behind isAnalyticsAllowed() and enable the consent banner first.' },
    { name: '@vercel/analytics', message: 'Vercel Analytics sets non-essential cookies under GDPR. Gate behind isAnalyticsAllowed() and enable the consent banner first.' },
    { name: '@vercel/analytics/react', message: 'Vercel Analytics sets non-essential cookies under GDPR. Gate behind isAnalyticsAllowed() and enable the consent banner first.' },
  ],
  patterns: [
    // Catch deep imports like 'posthog-js/lib/something'
    { group: ['posthog-js/*', 'mixpanel-*'], message: 'Gate analytics SDKs behind isAnalyticsAllowed() and enable the consent banner first.' },
  ],
}

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
      'no-restricted-imports': ['error', RESTRICTED_ANALYTICS_IMPORTS],
    },
  },
]

export default config
