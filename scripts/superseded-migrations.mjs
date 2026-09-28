#!/usr/bin/env node
/**
 * Reader for supabase/superseded-migrations.txt, the one list of migrations a
 * fresh database must skip. See the comment at the top of that file for what
 * qualifies and who consumes it.
 *
 * Every consumer goes through this module so there is exactly one parser.
 * CI used to carry its own hard-coded `rm` while the init.sql generator had no
 * exclusion at all; the two drifted and self-host installs broke.
 *
 * CLI (used by the workflows, which run on throwaway runners):
 *   node scripts/superseded-migrations.mjs list     print one filename per line
 *   node scripts/superseded-migrations.mjs remove   delete them from supabase/migrations/
 *
 * `remove` edits the working tree. Only CI should run it; locally use
 * `pnpm db:local`, which parks the files and puts them back.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MIGRATION_NAME = /^\d{14}_[a-z0-9_]+\.sql$/

export function supersededListPath(root = DEFAULT_ROOT) {
  return path.join(root, 'supabase', 'superseded-migrations.txt')
}

export function migrationsDirPath(root = DEFAULT_ROOT) {
  return path.join(root, 'supabase', 'migrations')
}

/**
 * Parses the list text. `#` starts a comment, blank lines are ignored, and
 * every remaining line must be exactly one migration filename.
 */
export function parseSupersededList(text) {
  const names = text
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*$/, '').trim())
    .filter((line) => line.length > 0)

  const seen = new Set()
  for (const name of names) {
    if (!MIGRATION_NAME.test(name)) {
      throw new Error(`superseded-migrations.txt: "${name}" is not a migration filename`)
    }
    if (seen.has(name)) {
      throw new Error(`superseded-migrations.txt: "${name}" is listed twice`)
    }
    seen.add(name)
  }
  return names
}

/**
 * Reads and validates the list for a repo root. Every entry must name a file
 * that exists: a typo would otherwise stop excluding the broken migration
 * everywhere without any error.
 */
export function readSupersededMigrations({ root = DEFAULT_ROOT } = {}) {
  const listFile = supersededListPath(root)
  const text = fs.existsSync(listFile) ? fs.readFileSync(listFile, 'utf8') : ''
  const names = parseSupersededList(text)
  const migrationsDir = migrationsDirPath(root)
  for (const name of names) {
    if (!fs.existsSync(path.join(migrationsDir, name))) {
      throw new Error(
        `superseded-migrations.txt: "${name}" does not exist in supabase/migrations/. ` +
          'Superseded files stay in git for the audit trail, so a missing one is a typo.',
      )
    }
  }
  return names
}

function main(argv) {
  const command = argv[2]
  const names = readSupersededMigrations()
  if (command === 'list') {
    for (const name of names) console.log(name)
    return 0
  }
  if (command === 'remove') {
    const migrationsDir = migrationsDirPath()
    for (const name of names) {
      fs.rmSync(path.join(migrationsDir, name))
      console.log(`removed supabase/migrations/${name} (superseded)`)
    }
    return 0
  }
  console.error('usage: node scripts/superseded-migrations.mjs <list|remove>')
  return 2
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    process.exitCode = main(process.argv)
  } catch (err) {
    console.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
  }
}
