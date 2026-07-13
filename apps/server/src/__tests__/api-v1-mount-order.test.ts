import { describe, expect, test } from 'vitest'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

/**
 * Source-level guard for the /api/v1 mount-order invariant in app.ts.
 *
 * evalsRouter and humanEvalsRouter mount at the broad `/api/v1` prefix and
 * register `.use('*', ...)` auth middleware. Hono matches in registration
 * order, so any /api/v1 route mounted AFTER those wildcards first passes
 * through their auth middleware. For routes with their own auth that is a
 * wasted duplicate Supabase round-trip; for dual-auth or public routes it is
 * an outright break — the wildcard's authJwt 401s the request before the
 * route's own middleware ever runs. This shipped twice: recommendations
 * (2026-06-04) and public feedback (PR #304).
 *
 * The fix is structural: the wildcard routers mount LAST among /api/v1
 * routes. This test pins that ordering so a new router added below them
 * fails CI instead of silently breaking in production.
 *
 * (Same source-guard pattern as require-edit-dual-auth.test.ts — behavior
 * cannot be asserted cheaply here because "auth ran twice" is invisible in
 * the response, so we pin the registration order in the source instead.)
 */

const WILDCARD_ROUTERS = ['evalsRouter', 'humanEvalsRouter'] as const

async function readAppSource(): Promise<string> {
  const path = fileURLToPath(new URL('../app.ts', import.meta.url))
  return readFile(path, 'utf8')
}

/** All `app.route('/api/v1...', xRouter)` mounts, in registration order. */
function apiV1Mounts(source: string): Array<{ path: string; router: string }> {
  const re = /^app\.route\('(\/api\/v1[^']*)',\s*(\w+)\)/gm
  const mounts: Array<{ path: string; router: string }> = []
  for (const m of source.matchAll(re)) {
    mounts.push({ path: m[1]!, router: m[2]! })
  }
  return mounts
}

describe('/api/v1 mount order in app.ts', () => {
  test('wildcard routers (evals, human-evals) are the LAST /api/v1 mounts', async () => {
    const mounts = apiV1Mounts(await readAppSource())
    expect(mounts.length).toBeGreaterThan(10) // sanity: regex still matches app.ts

    const lastTwo = mounts.slice(-WILDCARD_ROUTERS.length).map((m) => m.router)
    expect(lastTwo).toEqual([...WILDCARD_ROUTERS])
  })

  test('each wildcard router is mounted exactly once', async () => {
    const mounts = apiV1Mounts(await readAppSource())
    for (const router of WILDCARD_ROUTERS) {
      const count = mounts.filter((m) => m.router === router).length
      expect(count, `${router} must be mounted exactly once`).toBe(1)
    }
  })

  test('no other router is mounted at the bare /api/v1 prefix (except openapiRouter)', async () => {
    // openapiRouter is a public, middleware-free router (GET /openapi.json,
    // GET /docs) intentionally mounted before the dashboard rate limiter.
    // It registers no `use('*')`, so it cannot shadow anything. Any OTHER
    // bare `/api/v1` mount is a new wildcard hazard and must instead get a
    // specific prefix or be added to WILDCARD_ROUTERS above (mounted last).
    const mounts = apiV1Mounts(await readAppSource())
    const bare = mounts.filter((m) => m.path === '/api/v1').map((m) => m.router)
    expect(bare.sort()).toEqual(['evalsRouter', 'humanEvalsRouter', 'openapiRouter'])
  })
})
