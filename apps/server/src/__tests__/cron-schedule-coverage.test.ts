import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// Source guard against cron schedule drift. Every route defined in
// api/cron.ts must be scheduled by at least one version-controlled
// scheduler (vercel.json or .github/workflows/cron-server.yml), OR be
// listed in UNSCHEDULED below with a reason. This catches the class of
// bug found on 2026-07-22: four usage/billing crons were firing in
// production via an external Better Stack monitor but declared in
// neither repo scheduler, so their schedule was invisible in git and a
// dashboard deletion would have stopped them silently.

const here = dirname(fileURLToPath(import.meta.url))
const serverRoot = resolve(here, '..', '..') // apps/server
const repoRoot = resolve(serverRoot, '..', '..') // repository root

// Cron routes that intentionally have NO scheduler. Each entry needs a
// reason. The allowlist is self-cleaning: a separate test asserts every
// name here is a real route AND is still unscheduled, so a stale entry
// (route deleted, or later scheduled) fails CI.
const UNSCHEDULED: Record<string, string> = {
  'retry-webhooks':
    'Outbound webhooks have zero production usage (0 configured, 0 deliveries), so there is nothing to retry. Add a */5 job to cron-server.yml when webhooks ship to customers.',
}

function cronRoutes(): string[] {
  const src = readFileSync(resolve(serverRoot, 'src/api/cron.ts'), 'utf8')
  const out = new Set<string>()
  for (const m of src.matchAll(/cronRouter\.get\(\s*['"]\/([a-z0-9-]+)['"]/g)) {
    out.add(m[1]!)
  }
  return [...out].sort()
}

function vercelScheduled(): Set<string> {
  const json = JSON.parse(readFileSync(resolve(serverRoot, 'vercel.json'), 'utf8')) as {
    crons?: { path: string }[]
  }
  const out = new Set<string>()
  for (const c of json.crons ?? []) {
    const m = /^\/cron\/([a-z0-9-]+)$/.exec(c.path)
    if (m) out.add(m[1]!)
  }
  return out
}

function ghScheduled(): Set<string> {
  const yml = readFileSync(resolve(repoRoot, '.github/workflows/cron-server.yml'), 'utf8')
  const out = new Set<string>()
  // Match only the quoted curl invocation URLs ("$BASE_URL/cron/x"), not
  // the /cron/x paths that also appear in the header comments — a comment
  // mention must not count as "scheduled".
  for (const m of yml.matchAll(/\/cron\/([a-z0-9-]+)"/g)) out.add(m[1]!)
  return out
}

describe('cron schedule coverage guard', () => {
  const routes = cronRoutes()
  const vercel = vercelScheduled()
  const gh = ghScheduled()

  test('parsers find the expected shape (sanity)', () => {
    expect(routes.length).toBeGreaterThan(15)
    expect(vercel.size).toBeGreaterThan(10)
    expect(gh.size).toBeGreaterThan(10)
  })

  test('every cron route is scheduled somewhere or explicitly unscheduled', () => {
    const orphans = routes.filter(
      (r) => !vercel.has(r) && !gh.has(r) && !(r in UNSCHEDULED),
    )
    expect(
      orphans,
      `These /cron routes are declared in neither vercel.json nor cron-server.yml. ` +
        `Schedule them, or add to UNSCHEDULED with a reason: [${orphans.join(', ')}]`,
    ).toEqual([])
  })

  test('UNSCHEDULED allowlist has no stale entries', () => {
    for (const name of Object.keys(UNSCHEDULED)) {
      expect(routes, `UNSCHEDULED lists "${name}" but cron.ts has no such route`).toContain(name)
      expect(
        vercel.has(name) || gh.has(name),
        `"${name}" is now scheduled in vercel.json or cron-server.yml. Remove it from UNSCHEDULED.`,
      ).toBe(false)
    }
  })
})
