#!/usr/bin/env node
/**
 * Brings the local Supabase stack up in a state the app and the integration
 * tests can actually use.
 *
 * Two things stand between `supabase start` and a working local database, and
 * both of them are invisible until you hit them:
 *
 *   1. `20260609150000_register_orphan_span_link.sql` fails on a fresh
 *      database. Its INSERT omits `description`, which is NOT NULL, so
 *      Postgres rolls back and `supabase start` aborts partway through the
 *      migration chain. In production that migration was marked applied by
 *      hand and superseded by `..._v3`, so nothing there notices. CI deletes
 *      the file before running. Locally, until now, you had to know that.
 *
 *      It cannot simply be fixed in place: the file is tracked, already
 *      fake-applied in production, and the repo forbids editing a merged
 *      migration because the remote history is keyed by file hash. So this
 *      script moves it aside and puts it back, including on failure.
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

const BROKEN_MIGRATION = 'supabase/migrations/20260609150000_register_orphan_span_link.sql'
const PARKED = join(process.env['TEMP'] ?? '/tmp', 'spanlens-broken-migration.sql.parked')

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

function park() {
  if (existsSync(BROKEN_MIGRATION)) {
    renameSync(BROKEN_MIGRATION, PARKED)
    return true
  }
  return false
}

function unpark(wasParked) {
  // Restoring matters more than anything else this script does: leaving the
  // file parked would show up as a deleted migration in `git status` and,
  // if committed, would desync every other checkout and the deploy job.
  if (wasParked && existsSync(PARKED)) renameSync(PARKED, BROKEN_MIGRATION)
}

const wantsReset = process.argv.includes('--reset')
let parked = false

try {
  parked = park()
  if (parked) {
    console.log(`[local-db] parked ${BROKEN_MIGRATION} (see the note at the top of this script)`)
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
  console.log('[local-db] integration tests:')
  console.log('  SUPABASE_DB_POOLER_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres" \\')
  console.log('    pnpm --filter server test:integration')
} finally {
  unpark(parked)
  if (parked) console.log(`[local-db] restored ${BROKEN_MIGRATION}`)
}
