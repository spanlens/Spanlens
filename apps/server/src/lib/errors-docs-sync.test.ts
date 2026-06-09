import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ERROR_CODES } from './errors.js'

/**
 * Sprint 7 R-15 + R-20: keep the hand-authored docs catalog at
 * apps/web/app/docs/api/errors/page.tsx in sync with the runtime
 * ERROR_CODES catalog. The docs file is not generated because pulling
 * the server runtime into the Next bundle would add unwanted JS, but
 * we still want a build-time guarantee that every code the server can
 * throw is documented.
 *
 * The test parses the docs file as plain text and checks that every
 * ERROR_CODES key appears at least once. Spelling drift, a missing
 * entry, or a renamed code all surface here as a failing test.
 *
 * The reverse drift (a docs entry with no server code) is intentionally
 * NOT enforced. A code we documented but later dropped may still appear
 * in old client SDKs in the wild, and keeping the docs page describing
 * what it used to mean is a feature, not a bug.
 */

function resolveDocsPath(): string {
  // apps/server/src/lib/errors-docs-sync.test.ts
  //   here = apps/server/src/lib
  //   ../   = apps/server/src
  //   ../../ = apps/server
  //   ../../../ = apps
  //   ../../../web/app/... = apps/web/app/...
  const here = dirname(fileURLToPath(import.meta.url))
  return resolve(here, '../../../web/app/docs/api/errors/page.tsx')
}

describe('docs page mirrors the ERROR_CODES catalog', () => {
  const docsText = readFileSync(resolveDocsPath(), 'utf8')
  const serverCodes = Object.keys(ERROR_CODES)

  it.each(serverCodes)('docs/api/errors page mentions %s', (code) => {
    expect(docsText.includes(code)).toBe(true)
  })

  it('docs page references the standard envelope keys (code, message, details, requestId)', () => {
    // Loose check: the prose section explains the four fields by name.
    // A bigger restructure that drops one of them should fail this so
    // the docs stay accurate.
    for (const field of ['code', 'message', 'details', 'requestId']) {
      expect(docsText).toContain(field)
    }
  })

  it('docs page documents the X-Request-ID header alongside the envelope', () => {
    expect(docsText).toContain('X-Request-ID')
  })
})
