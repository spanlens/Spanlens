// Run: node --test "scripts/__tests__/*.test.mjs"
//
// Source guards for .github/workflows/e2e.yml, plus the check that no
// workflow or setup script carries its own copy of the superseded-migration
// list. The e2e workflow used to be manual-only, so a deterministic failure in
// it went unnoticed; these assertions keep the pieces that fixed it in place.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { readSupersededMigrations } from '../superseded-migrations.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8').replace(/\r\n/g, '\n')

const e2e = read('.github/workflows/e2e.yml')

test('e2e.yml runs on pull requests that touch auth, proxy, ingest, billing or middleware', () => {
  assert.match(e2e, /\n {2}pull_request:\n/)
  for (const p of [
    'apps/server/src/proxy/**',
    'apps/server/src/middleware/**',
    'apps/web/middleware.ts',
    'apps/web/__e2e__/**',
  ]) {
    assert.ok(e2e.includes(`'${p}'`), `e2e.yml paths filter is missing ${p}`)
  }
  assert.match(e2e, /workflow_dispatch:/)
})

test('e2e.yml gives the web process the service-role key the middleware needs', () => {
  // Without it middleware.ts cannot resolve the org or the onboarded flag, so
  // every signed-in navigation lands on /onboarding.
  const webStep = e2e.slice(e2e.indexOf('- name: Start web'))
  const env = webStep.slice(0, webStep.indexOf('run:'))
  assert.match(env, /SUPABASE_SERVICE_ROLE_KEY: \$\{\{ env\.E2E_SUPABASE_SERVICE_KEY \}\}/)
})

test('e2e.yml removes superseded migrations through the shared list', () => {
  assert.match(e2e, /node scripts\/superseded-migrations\.mjs remove/)
  assert.doesNotMatch(e2e, /rm -f supabase\/migrations\//)
})

test('no workflow or setup script hard-codes a superseded migration filename', () => {
  // The root cause of the broken self-host install was two lists: an `rm`
  // in ci.yml and nothing in the generator. Every consumer now reads the
  // shared file through scripts/superseded-migrations.mjs.
  const names = readSupersededMigrations({ root: repoRoot })
  const workflowsDir = path.join(repoRoot, '.github', 'workflows')
  const files = [
    ...fs.readdirSync(workflowsDir).map((f) => path.join(workflowsDir, f)),
    path.join(repoRoot, 'scripts', 'local-db-setup.mjs'),
  ]
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8')
    for (const name of names) {
      assert.ok(!text.includes(name), `${path.relative(repoRoot, file)} hard-codes ${name}`)
    }
  }
})
