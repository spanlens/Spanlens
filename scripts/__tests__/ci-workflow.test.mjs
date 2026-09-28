// Run: node --test "scripts/__tests__/*.test.mjs"
//
// Source guards for .github/workflows. Each assertion pins a gate that used to
// be missing: a suite that existed and passed locally but that no workflow ran,
// so its regressions reached main unnoticed. The checks read the YAML as text
// on purpose, because the thing being guarded is "this command is present in
// the PR workflow", and a YAML parser dependency buys nothing for that.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8').replace(/\r\n/g, '\n')

const ci = read('.github/workflows/ci.yml')

/**
 * Index of the first non-comment line containing `needle`, or -1. Used for
 * ordering checks, so a comment that mentions a command does not count.
 */
function lineOf(text, needle) {
  return text
    .split('\n')
    .findIndex((line) => !line.trimStart().startsWith('#') && line.includes(needle))
}

test('ci.yml runs the web unit tests', () => {
  assert.match(ci, /run: pnpm --filter web test\b/)
})

test('ci.yml runs the node:test suite for repository scripts', () => {
  assert.match(ci, /node --test "scripts\/__tests__\/\*\.test\.mjs"/)
})

test('ci.yml lints the published packages, not just web and server', () => {
  for (const pkg of ['@spanlens/sdk', '@spanlens/cli', '@spanlens/mcp-server']) {
    assert.ok(ci.includes(`pnpm --filter ${pkg} lint`), `missing lint step for ${pkg}`)
  }
})

test('ci.yml fails when supabase/init.sql is stale', () => {
  assert.match(ci, /node scripts\/generate-init-sql\.mjs --check/)
})

test('ci.yml removes superseded migrations through the shared list, after init.sql is built', () => {
  assert.match(ci, /node scripts\/superseded-migrations\.mjs remove/)
  assert.doesNotMatch(ci, /rm -f supabase\/migrations\//)
  // The generator validates that every listed file exists, so it has to run
  // before the workflow deletes them.
  const generate = lineOf(ci, 'generate-init-sql.mjs --out')
  const remove = lineOf(ci, 'superseded-migrations.mjs remove')
  assert.ok(generate !== -1 && remove !== -1 && generate < remove)
})

test('ci.yml applies the generated init.sql to an empty database as one query', () => {
  // The SQL Editor path the README recommends sends the file as a single
  // query; scripts/apply-init-sql.mjs reproduces that. The database must be
  // empty, so the migrations directory is parked before `supabase start`.
  const park = lineOf(ci, 'mv supabase/migrations "$RUNNER_TEMP/migrations"')
  const start = lineOf(ci, 'supabase start')
  const apply = lineOf(ci, 'node scripts/apply-init-sql.mjs')
  const restore = lineOf(ci, 'mv "$RUNNER_TEMP/migrations" supabase/migrations')
  assert.ok(park !== -1, 'migrations are never parked')
  assert.ok(park < start && start < apply && apply < restore, 'park → start → apply → restore order')
  assert.match(ci, /node scripts\/apply-init-sql\.mjs "\$LOCAL_DB_URL" "\$RUNNER_TEMP\/init\.sql"/)
})

test('ci.yml runs every supabase/tests/*.sql file, not a hard-coded one', () => {
  assert.match(ci, /for f in supabase\/tests\/\*\.sql/)
})

test('ci.yml runs the real-Postgres integration suite after migrations are applied', () => {
  const reset = lineOf(ci, 'supabase db reset --no-seed')
  const integration = lineOf(ci, 'pnpm --filter server test:integration')
  assert.ok(reset !== -1, 'db reset step missing')
  assert.ok(integration > reset, 'test:integration must run after db reset')
})
