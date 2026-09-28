// Run: node --test "scripts/__tests__/*.test.mjs"
//
// The spanlens-server Vercel project builds from the repository root, so the
// root vercel.json is its live config (deployment logs show entrypoint "."
// and the root installCommand). Vercel compiles api/index.ts itself; the
// `build` script's tsc emit only exists for `node dist/index.js` (self-host
// and CI). Pointing the deploy at `build` would add a full tsc run to every
// deploy and let a type error block a production release, which is a
// decision to make on purpose, not a side effect of a package.json edit.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(repoRoot, rel), 'utf8'))

test('the root vercel.json deploy runs a no-op server script, not the tsc emit', () => {
  const { buildCommand } = readJson('vercel.json')
  const match = /^pnpm --filter server ([\w:-]+)$/.exec(buildCommand ?? '')
  assert.ok(match, `unexpected buildCommand: ${buildCommand}`)

  const script = readJson('apps/server/package.json').scripts[match[1]]
  assert.ok(script, `apps/server has no "${match[1]}" script`)
  // A no-op on purpose: whatever this script does runs on every production
  // deploy, so turning it into real work should take an edit to this test.
  assert.match(script, /^echo\s/, `the deploy runs "${match[1]}" (${script}), which is not a no-op`)
})

test('the server build script still emits dist for node dist/index.js', () => {
  const { scripts } = readJson('apps/server/package.json')
  assert.match(scripts.build, /\btsc --project tsconfig\.build\.json\b/)
  assert.equal(scripts.start, 'node dist/index.js')
})
