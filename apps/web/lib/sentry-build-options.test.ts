import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Source guard for the Sentry options passed to withSentryConfig in
 * next.config.mjs.
 *
 * Two options sat there doing nothing useful on @sentry/nextjs 10 with
 * Turbopack (the default bundler for bare `next build`):
 *
 *   hideSourceMaps  no longer read anywhere in the SDK. Keeping browser source
 *                   maps off the CDN is now `sourcemaps.deleteSourcemapsAfterUpload`,
 *                   which defaults to true.
 *   disableLogger   deprecated in favour of webpack.treeshake.removeDebugLogging,
 *                   which Turbopack does not support. Its only visible effect
 *                   was a DEPRECATION warning printed on every build, which
 *                   `silent: true` cannot suppress because it is a bare
 *                   console.warn.
 *
 * Reading the file as text keeps this test from executing withSentryConfig.
 */
const source = readFileSync(path.resolve(__dirname, '..', 'next.config.mjs'), 'utf8')
const optionsBlock = source.slice(source.indexOf('const sentryConfig'), source.indexOf('export default'))

describe('next.config.mjs Sentry build options', () => {
  it('finds the options object', () => {
    expect(optionsBlock).toContain('tunnelRoute')
  })

  it.each(['hideSourceMaps', 'disableLogger'])('does not pass the dead option %s', (option) => {
    expect(optionsBlock).not.toMatch(new RegExp(`\\b${option}\\s*:`))
  })

  it('keeps the build quiet and the ad-blocker tunnel', () => {
    expect(optionsBlock).toMatch(/\bsilent:\s*true/)
    expect(optionsBlock).toMatch(/\btunnelRoute:\s*'\/monitoring'/)
  })
})
