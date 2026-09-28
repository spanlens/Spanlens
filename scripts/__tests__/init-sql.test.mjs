// Run: node --test scripts/__tests__/
//
// Guards the self-host install path. supabase/init.sql is what the README and
// /docs/self-host tell people to paste into the Supabase SQL Editor, which
// sends the whole file as one query: a single failing statement rolls back
// everything after the last COMMIT. A broken migration that CI quietly skips
// but init.sql still contains therefore produces a half-installed database
// with no `requests` table, and nothing in CI used to notice.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  buildInitSql,
  diffInitSql,
  listMigrationFiles,
} from '../generate-init-sql.mjs'
import {
  parseSupersededList,
  readSupersededMigrations,
} from '../superseded-migrations.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Builds a throwaway repo layout: supabase/migrations/* plus the list file. */
function makeFixture({ migrations, supersededText = '' }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spanlens-init-sql-'))
  const migrationsDir = path.join(root, 'supabase', 'migrations')
  fs.mkdirSync(migrationsDir, { recursive: true })
  for (const [name, sql] of Object.entries(migrations)) {
    fs.writeFileSync(path.join(migrationsDir, name), sql, 'utf8')
  }
  fs.writeFileSync(path.join(root, 'supabase', 'superseded-migrations.txt'), supersededText, 'utf8')
  return root
}

const GOOD_A = '20260101000000_create_a.sql'
const BROKEN = '20260101000100_broken_insert.sql'
const FIX = '20260101000200_broken_insert_v2.sql'

function threeMigrationFixture() {
  return makeFixture({
    migrations: {
      [FIX]: 'INSERT INTO a VALUES (1, \'described\');\n',
      [GOOD_A]: 'CREATE TABLE a (id int, description text NOT NULL);\n',
      [BROKEN]: 'INSERT INTO a (id) VALUES (1);\n',
    },
    supersededText: `# comment line\n\n${BROKEN}  # superseded by ${FIX}\n`,
  })
}

// ── superseded list parsing ─────────────────────────────────────────────────

test('parseSupersededList ignores comments, blank lines and trailing comments', () => {
  const names = parseSupersededList(`# header\n\n${BROKEN}   # why\n  \n`)
  assert.deepEqual(names, [BROKEN])
})

test('parseSupersededList rejects a line that is not a migration filename', () => {
  assert.throws(() => parseSupersededList('register_orphan_span_link.sql\n'), /not a migration filename/)
  assert.throws(() => parseSupersededList('20260101000100_broken insert.sql\n'), /not a migration filename/)
})

test('parseSupersededList rejects duplicates', () => {
  assert.throws(() => parseSupersededList(`${BROKEN}\n${BROKEN}\n`), /listed twice/)
})

test('readSupersededMigrations refuses an entry with no matching file', () => {
  // A typo here would silently stop excluding the broken file everywhere.
  const root = makeFixture({
    migrations: { [GOOD_A]: 'SELECT 1;\n' },
    supersededText: `${BROKEN}\n`,
  })
  assert.throws(() => readSupersededMigrations({ root }), /does not exist/)
})

// ── init.sql generation ─────────────────────────────────────────────────────

test('buildInitSql leaves superseded migrations out and keeps the rest in order', () => {
  const root = threeMigrationFixture()
  const sql = buildInitSql({ root })

  assert.ok(!sql.includes(`-- Migration: ${BROKEN}\n`), 'superseded migration must not be concatenated')
  assert.ok(!sql.includes('INSERT INTO a (id) VALUES (1);'), 'superseded SQL body must not leak in')

  const posA = sql.indexOf(`-- Migration: ${GOOD_A}\n`)
  const posFix = sql.indexOf(`-- Migration: ${FIX}\n`)
  assert.ok(posA > 0 && posFix > posA, 'remaining migrations appear in filename order')
})

test('buildInitSql names the excluded migrations in the header', () => {
  const sql = buildInitSql({ root: threeMigrationFixture() })
  const header = sql.slice(0, sql.indexOf('-- Migration:'))
  assert.match(header, new RegExp(`${BROKEN}`))
})

test('buildInitSql output is LF-only even when migrations were checked out with CRLF', () => {
  const root = makeFixture({ migrations: { [GOOD_A]: 'SELECT 1;\r\nSELECT 2;\r\n' } })
  assert.ok(!buildInitSql({ root }).includes('\r'))
})

test('listMigrationFiles returns every .sql file sorted, superseded ones included', () => {
  const root = threeMigrationFixture()
  fs.writeFileSync(path.join(root, 'supabase', 'migrations', 'README.md'), 'not sql', 'utf8')
  assert.deepEqual(listMigrationFiles({ root }), [GOOD_A, BROKEN, FIX])
})

// ── drift check ─────────────────────────────────────────────────────────────

test('diffInitSql reports missing and unexpected migrations for a stale init.sql', () => {
  const root = threeMigrationFixture()
  // Stale: generated before FIX existed and before BROKEN was excluded.
  const stale = [
    '-- header',
    `-- Migration: ${GOOD_A}`,
    'CREATE TABLE a (id int, description text NOT NULL);',
    `-- Migration: ${BROKEN}`,
    'INSERT INTO a (id) VALUES (1);',
    '',
  ].join('\n')
  fs.writeFileSync(path.join(root, 'supabase', 'init.sql'), stale, 'utf8')

  const diff = diffInitSql({ root })
  assert.equal(diff.upToDate, false)
  assert.deepEqual(diff.missing, [FIX])
  assert.deepEqual(diff.unexpected, [BROKEN])
})

test('diffInitSql passes for a freshly generated init.sql, including a CRLF checkout of it', () => {
  const root = threeMigrationFixture()
  const fresh = buildInitSql({ root })
  fs.writeFileSync(path.join(root, 'supabase', 'init.sql'), fresh.replace(/\n/g, '\r\n'), 'utf8')
  assert.deepEqual(diffInitSql({ root }), { upToDate: true, missing: [], unexpected: [] })
})

test('diffInitSql flags an edited migration even when the file list matches', () => {
  const root = threeMigrationFixture()
  const fresh = buildInitSql({ root })
  fs.writeFileSync(path.join(root, 'supabase', 'init.sql'), fresh, 'utf8')
  fs.writeFileSync(path.join(root, 'supabase', 'migrations', GOOD_A), 'CREATE TABLE a (id bigint);\n', 'utf8')
  const diff = diffInitSql({ root })
  assert.equal(diff.upToDate, false)
  assert.deepEqual(diff.missing, [])
  assert.deepEqual(diff.unexpected, [])
})

// ── the real repository ─────────────────────────────────────────────────────

test('the orphan-span-link migration that breaks fresh installs is on the superseded list', () => {
  const names = readSupersededMigrations({ root: repoRoot })
  assert.ok(names.includes('20260609150000_register_orphan_span_link.sql'))
})

test('the real init.sql build skips the broken INSERT but keeps its v3 replacement', () => {
  const sql = buildInitSql({ root: repoRoot })
  assert.ok(!sql.includes('-- Migration: 20260609150000_register_orphan_span_link.sql\n'))
  assert.ok(sql.includes('-- Migration: 20260609170000_register_orphan_span_link_v3.sql\n'))
  assert.ok(!/INSERT INTO background_migrations \(name, status\)/.test(sql))
})
