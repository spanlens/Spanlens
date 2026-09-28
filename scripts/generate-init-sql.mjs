#!/usr/bin/env node
/**
 * Concatenates supabase/migrations/*.sql (sorted by name) into
 * supabase/init.sql, a single file self-hosters can run in the Supabase SQL
 * Editor without needing the Supabase CLI.
 *
 * Migrations listed in supabase/superseded-migrations.txt are left out, the
 * same set CI removes before `supabase db reset`. The SQL Editor sends the
 * whole file as one query, so a single failing statement rolls back every
 * statement since the last COMMIT and skips the rest of the file. Including a
 * migration that only works because production fake-applied it therefore
 * produces a half-installed database.
 *
 * Usage:
 *   node scripts/generate-init-sql.mjs              rewrite supabase/init.sql
 *   node scripts/generate-init-sql.mjs --check      exit 1 if supabase/init.sql is stale
 *   node scripts/generate-init-sql.mjs --out <file> write the result somewhere else
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { migrationsDirPath, readSupersededMigrations } from './superseded-migrations.mjs'

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MIGRATION_MARKER = /^-- Migration: (\d{14}_[^\s]+\.sql)$/gm

function initSqlPath(root) {
  return path.join(root, 'supabase', 'init.sql')
}

/** Git on Windows checks files out with CRLF; the generated file is LF-only. */
function toLf(text) {
  return text.replace(/\r\n/g, '\n')
}

/** Every migration file on disk, sorted, including superseded ones. */
export function listMigrationFiles({ root = DEFAULT_ROOT } = {}) {
  return fs
    .readdirSync(migrationsDirPath(root))
    .filter((f) => f.endsWith('.sql'))
    .sort()
}

function renderHeader(excluded) {
  const excludedLines =
    excluded.length === 0
      ? ['--   (none)']
      : excluded.map((name) => `--   ${name}`)
  return [
    '-- =============================================================================',
    '-- Spanlens full database initialisation script',
    '-- =============================================================================',
    '-- Run this once against your Supabase project to create all tables, functions,',
    '-- triggers, RLS policies, and seed data required by Spanlens.',
    '--',
    '-- How to run:',
    '--   Option A (Supabase Dashboard):',
    '--     1. Open your project → SQL Editor → New query',
    '--     2. Paste the entire contents of this file and click Run',
    '--',
    '--   Option B (psql / CI):',
    '--     psql "postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres" \\',
    '--       -v ON_ERROR_STOP=1 -f supabase/init.sql',
    '--',
    '-- This file is generated from supabase/migrations/, so edit those instead.',
    '-- Regenerate with: node scripts/generate-init-sql.mjs',
    '--',
    '-- Superseded migrations left out (see supabase/superseded-migrations.txt):',
    ...excludedLines,
    '-- =============================================================================',
    '',
    '',
  ].join('\n')
}

/** Builds the init.sql text for a repo root. Pure apart from reading files. */
export function buildInitSql({ root = DEFAULT_ROOT } = {}) {
  const superseded = new Set(readSupersededMigrations({ root }))
  const files = listMigrationFiles({ root }).filter((f) => !superseded.has(f))
  const migrationsDir = migrationsDirPath(root)

  const parts = [renderHeader([...superseded].sort())]
  for (const file of files) {
    const content = toLf(fs.readFileSync(path.join(migrationsDir, file), 'utf8')).trim()
    parts.push(`
-- -----------------------------------------------------------------------------
-- Migration: ${file}
-- -----------------------------------------------------------------------------
${content}

`)
  }
  return parts.join('')
}

function migrationMarkers(sql) {
  return [...sql.matchAll(MIGRATION_MARKER)].map((m) => m[1])
}

/**
 * Compares the committed supabase/init.sql with a fresh build. `missing` and
 * `unexpected` name the migrations whose presence differs; an edited file with
 * the same list still reports `upToDate: false`.
 */
export function diffInitSql({ root = DEFAULT_ROOT } = {}) {
  const expected = buildInitSql({ root })
  const file = initSqlPath(root)
  const actual = fs.existsSync(file) ? toLf(fs.readFileSync(file, 'utf8')) : ''

  const expectedSet = new Set(migrationMarkers(expected))
  const actualSet = new Set(migrationMarkers(actual))
  return {
    upToDate: expected === actual,
    missing: [...expectedSet].filter((f) => !actualSet.has(f)),
    unexpected: [...actualSet].filter((f) => !expectedSet.has(f)),
  }
}

function runCheck(root) {
  const diff = diffInitSql({ root })
  if (diff.upToDate) {
    console.log('supabase/init.sql is up to date')
    return 0
  }
  console.error('supabase/init.sql is out of date with supabase/migrations/.')
  for (const f of diff.missing) console.error(`  missing:    ${f}`)
  for (const f of diff.unexpected) console.error(`  unexpected: ${f}`)
  if (diff.missing.length === 0 && diff.unexpected.length === 0) {
    console.error('  (same migrations, different content: a migration or the header changed)')
  }
  console.error('Regenerate with: node scripts/generate-init-sql.mjs')
  return 1
}

function runWrite(root, outFile) {
  const output = buildInitSql({ root })
  fs.writeFileSync(outFile, output, 'utf8')
  const count = migrationMarkers(output).length
  const lineCount = output.split('\n').length
  console.log(`Generated ${path.relative(process.cwd(), outFile) || outFile}: ${count} migrations, ${lineCount} lines`)
  return 0
}

function main(argv) {
  const args = argv.slice(2)
  if (args.includes('--check')) return runCheck(DEFAULT_ROOT)
  const outIndex = args.indexOf('--out')
  if (outIndex !== -1) {
    const out = args[outIndex + 1]
    if (!out) {
      console.error('--out needs a file path')
      return 2
    }
    return runWrite(DEFAULT_ROOT, path.resolve(out))
  }
  return runWrite(DEFAULT_ROOT, initSqlPath(DEFAULT_ROOT))
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    process.exitCode = main(process.argv)
  } catch (err) {
    console.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
  }
}
