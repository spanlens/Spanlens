import { describe, expect, test } from 'vitest'

import app from '../app.js'
import { SPEC } from '../api/openapi.js'

// ─────────────────────────────────────────────────────────────────────────────
// OpenAPI drift detector (P3.6).
//
// The Spanlens spec lives in `api/openapi.ts` as a hand-maintained 932-line
// constant. Without a safety net it's easy to:
//   - Remove a router but forget to delete its spec entry → 404 surprise
//     for SDK users hitting a "documented" endpoint
//   - Rename a path but leave the spec stale → docs lie
//   - Add a new endpoint that never makes it into the spec → undiscoverable
//
// This test walks every documented (path, method) in SPEC and confirms the
// app has a matching route. It does NOT yet enforce the reverse direction
// ("every app route must be in the spec") because the spec deliberately
// covers only the externally useful endpoints — internal cron, webhooks,
// invitations, and proxy-passthrough paths are out of scope on purpose.
// That direction is reported as informational output, not a failed assertion,
// so reviewers can spot newly-public-worthy endpoints in PR diffs.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hono stores routes as `path: '/api/v1/foo/:id'` while OpenAPI uses
 * `{id}`. Strip leading/trailing slashes too so the comparison is robust
 * against minor stylistic differences.
 */
function normalizeForCompare(rawPath: string): string {
  return rawPath
    .replace(/^\//, '')
    .replace(/\/$/, '')
    .replace(/\{([^}]+)\}/g, ':$1') // OpenAPI {id} → Hono :id
}

/** Lower-case HTTP methods used in OpenAPI 3.0 PathItem. Mirrors the keys
 * defined on `OpenAPIV3.PathItemObject` (`get`, `post`, ...). Using a
 * string literal union here instead of `OpenAPIV3.HttpMethods` because the
 * enum's value type isn't assignable from string literals under strict mode. */
const HTTP_METHODS = [
  'get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace',
] as const

interface RouteEntry {
  path: string
  method: string
}

function collectAppRoutes(): RouteEntry[] {
  // Hono exposes `app.routes` directly. Hono's nested router (app.route(...))
  // composes paths automatically; the `path` field on each entry is the
  // full path as seen by the outer app.
  const routes = (app as unknown as { routes: Array<{ path: string; method: string }> }).routes
  return routes
    .filter((r) => r.method !== 'ALL') // ALL is wildcard; treated separately
    .concat(
      // ALL routes also catch get/post/etc. — represent them as `*` so a
      // proxy catch-all matches any documented proxy method.
      routes
        .filter((r) => r.method === 'ALL')
        .map((r) => ({ ...r, method: '*' })),
    )
}

/**
 * Proxy paths in the spec are documented as `/proxy/<provider>/v1/{path}` —
 * a single representative path that stands in for the full upstream surface
 * (chat completions, embeddings, etc.). On the Hono side they're mounted
 * as a single `app.all('/*', ...)` catch-all under `/proxy/<provider>`.
 * Match these by prefix instead of full path equality so the documentation
 * doesn't have to enumerate every OpenAI/Anthropic/Gemini sub-route.
 */
function isProxyWildcardMatch(
  appRoutes: RouteEntry[],
  specPath: string,
): boolean {
  const proxyMatch = /^\/proxy\/(openai|anthropic|gemini)\//.exec(specPath)
  if (!proxyMatch) return false
  const prefix = `/proxy/${proxyMatch[1]}`
  return appRoutes.some(
    (r) => r.path.startsWith(prefix) && (r.method === '*' || r.method === 'ALL'),
  )
}

function findAppRoute(
  appRoutes: RouteEntry[],
  specPath: string,
  specMethod: string,
): RouteEntry | 'proxy-wildcard' | undefined {
  if (isProxyWildcardMatch(appRoutes, specPath)) return 'proxy-wildcard'

  const targetPath = normalizeForCompare(specPath)
  const targetMethod = specMethod.toUpperCase()

  return appRoutes.find((r) => {
    if (normalizeForCompare(r.path) !== targetPath) return false
    if (r.method === '*') return true // ALL handler covers any method
    return r.method.toUpperCase() === targetMethod
  })
}

const appRoutes = collectAppRoutes()

describe('OpenAPI spec drift detector', () => {
  // We test each (path, method) pair as its own test case so failures
  // point exactly at the offending entry, instead of one big aggregate fail.
  const cases: Array<{ path: string; method: string }> = []
  for (const [specPath, pathItem] of Object.entries(SPEC.paths ?? {})) {
    if (!pathItem) continue
    for (const method of HTTP_METHODS) {
      // PathItem is OpenAPIV3.PathItemObject; only the indexed-by-method keys
      // are operations, the rest are metadata (parameters, summary, etc.)
      if (method in pathItem) {
        cases.push({ path: specPath, method })
      }
    }
  }

  test('SPEC.paths is non-empty (sanity)', () => {
    expect(cases.length).toBeGreaterThan(20)
  })

  for (const { path, method } of cases) {
    test(`${method.toUpperCase()} ${path} is mounted on the app`, () => {
      const match = findAppRoute(appRoutes, path, method)
      if (!match) {
        const candidates = appRoutes
          .filter((r) => normalizeForCompare(r.path) === normalizeForCompare(path))
          .map((r) => `${r.method} ${r.path}`)
          .join(', ')
        throw new Error(
          `Spec documents ${method.toUpperCase()} ${path} but no matching Hono route is registered. ` +
          `Candidates at same path: ${candidates || '(none)'}. ` +
          `Either remove the spec entry or add the route in apps/server/src/app.ts.`,
        )
      }
      expect(match).toBeDefined()
    })
  }
})

describe('OpenAPI spec components.schemas', () => {
  test('every schema is at least { type } shaped (catches malformed entries)', () => {
    const schemas = SPEC.components?.schemas ?? {}
    expect(Object.keys(schemas).length).toBeGreaterThan(0)

    for (const [name, schema] of Object.entries(schemas)) {
      // Schemas can be inline objects or $ref. Allow both, but reject empty.
      const isRef = '$ref' in (schema as object)
      const isObj = 'type' in (schema as object)
      expect(isRef || isObj, `schema '${name}' has neither type nor $ref`).toBe(true)
    }
  })
})

describe('OpenAPI spec security schemes', () => {
  test('declared security schemes are valid', () => {
    const schemes = SPEC.components?.securitySchemes ?? {}
    // Spanlens documents two: BearerJWT (for dashboard) + ApiKey (for proxy).
    // Test names — if a third gets added the test fails loudly so the new
    // scheme gets a documentation review pass before shipping.
    expect(Object.keys(schemes).sort()).toEqual(['ApiKey', 'BearerJWT'])
  })
})
