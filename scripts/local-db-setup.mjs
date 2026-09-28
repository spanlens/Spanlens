#!/usr/bin/env node
/**
 * Brings the local Supabase stack up in a state the app and the integration
 * tests can actually use.
 *
 * Two things stand between `supabase start` and a working local database, and
 * both of them are invisible until you hit them:
 *
 *   1. Superseded migrations fail on a fresh database. The one that started
 *      this (the orphan-span-link registration) omits a NOT NULL column, so
 *      Postgres rolls back and `supabase start` aborts partway through the
 *      migration chain. In production such a migration was marked applied by
 *      hand and replaced by a later file, so nothing there notices. CI deletes
 *      them before running. Locally, until now, you had to know that.
 *
 *      They cannot simply be fixed in place: the files are tracked, already
 *      fake-applied in production, and the repo forbids editing a merged
 *      migration because the remote history is keyed by file hash. So this
 *      script moves every file on supabase/superseded-migrations.txt aside
 *      and puts it back, including on failure.
 *
 *   2. The local CLI image sets a more restrictive default ACL for the
 *      `postgres` role than the hosted platform does. Tables created by
 *      migrations therefore land with no INSERT/SELECT/UPDATE/DELETE for
 *      `service_role`, and every server call fails with "permission denied".
 *      Production grants the full set, so this only ever bites locally.
 *
 * Usage:
 *   pnpm db:local           start (if needed), apply migrations, fix grants
 *   pnpm db:local --reset   also run `supabase db reset --no-seed` first
 *
 * The integration suite needs this to have run. See
 * apps/server/vitest.integration.config.ts.
 */

import { execFileSync, execSync } from 'node:child_process'
import { existsSync, renameSync } from 'node:fs'
import { join } from 'node:path'

import { readSupersededMigrations } from './superseded-migrations.mjs'

const PARK_DIR = process.env['TEMP'] ?? '/tmp'
const SUPERSEDED = readSupersededMigrations().map((name) => ({
  file: `supabase/migrations/${name}`,
  parked: join(PARK_DIR, `spanlens-${name}.parked`),
}))

const DB_CONTAINER = 'supabase_db_spanlens'
const LOCAL_DB = 'postgresql://postgres:postgres@127.0.0.1:5432/postgres'

/**
 * Mirrors what the hosted platform grants. Without this, `service_role`
 * inherits only TRUNCATE/REFERENCES/TRIGGER on anything a migration created,
 * which reads as a baffling permissions error rather than an environment
 * difference.
 */
const GRANTS = `
GRANT ALL ON ALL TABLES    IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
`

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { stdio: 'inherit', shell: true, ...opts })
}

function dbIsRunning() {
  try {
    const out = execSync(`docker ps --filter name=${DB_CONTAINER} --format "{{.Names}}"`, {
      encoding: 'utf8',
    })
    return out.includes(DB_CONTAINER)
  } catch {
    return false
  }
}

/** Moves every superseded migration aside. Returns the ones it moved. */
function park() {
  const moved = SUPERSEDED.filter((entry) => existsSync(entry.file))
  for (const entry of moved) renameSync(entry.file, entry.parked)
  return moved
}

function unpark(parkedEntries) {
  // Restoring matters more than anything else this script does: leaving a
  // file parked would show up as a deleted migration in `git status` and,
  // if committed, would desync every other checkout and the deploy job.
  for (const entry of parkedEntries) {
    if (existsSync(entry.parked)) renameSync(entry.parked, entry.file)
  }
}

const wantsReset = process.argv.includes('--reset')
let parked = []

try {
  parked = park()
  for (const entry of parked) {
    console.log(`[local-db] parked ${entry.file} (see the note at the top of this script)`)
  }

  if (!dbIsRunning()) {
    console.log('[local-db] starting Supabase...')
    run('npx', ['supabase', 'start'])
  } else {
    console.log('[local-db] Supabase already running')
  }

  if (wantsReset) {
    console.log('[local-db] resetting database (migrations only, no seed)...')
    run('npx', ['supabase', 'db', 'reset', '--no-seed'])
  }

  console.log('[local-db] aligning grants with the hosted platform...')
  run('docker', ['exec', '-i', DB_CONTAINER, 'psql', `"${LOCAL_DB}"`, '-v', 'ON_ERROR_STOP=1', '-c', `"${GRANTS.replace(/\n/g, ' ')}"`])

  console.log('\n[local-db] ready.')
  console.log('[local-db] integration tests (no env needed, they default to this stack):')
  console.log('  pnpm --filter server test:integration')
} finally {
  unpark(parked)
  for (const entry of parked) console.log(`[local-db] restored ${entry.file}`)
}
