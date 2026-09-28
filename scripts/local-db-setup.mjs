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
 *      Fixing that has to reproduce production, not just "grant enough".
 *      Production is the hosted creation-time grants MINUS whatever the
 *      migrations then revoke. This script used to stop at the first half
 *      (GRANT ALL on every table and function to anon and authenticated),
 *      which quietly undid every REVOKE in the migrations: locally the anon
 *      key could call ensure_requests_partitions() and write any table,
 *      while production could not, so local testing could neither reproduce
 *      nor rule out a permissions bug. It now applies the hosted grants and
 *      then calls public.enforce_client_privileges(), the same function the
 *      migrations use to take them back (20260929100000).
 *
 * Usage:
 *   pnpm db:local           start (if needed), then align grants with production
 *   pnpm db:local --reset   also run `supabase db reset --no-seed` first
 *
 * On a stack that was already running, this does not apply new migrations.
 * If the privilege function is missing the script stops and says so, rather
 * than leaving the database with the hosted grants and none of the revokes.
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

/** Defined by 20260929100000_revoke_client_direct_writes.sql. */
const PRIVILEGE_MODEL_FN = 'public.enforce_client_privileges()'

/**
 * Two steps, in the order production went through them, run as one
 * transaction so a failure leaves the grants exactly as they were.
 *
 * Step 1 is what the hosted platform grants when a migration creates an
 * object. Without it, `service_role` inherits only TRUNCATE/REFERENCES/TRIGGER
 * on anything a migration created, which reads as a baffling permissions
 * error rather than an environment difference.
 *
 * Step 2 is what the migrations then take back: no client-role writes, no
 * client access to the requests tables, no client-callable functions except
 * is_org_member(). Skipping it is how local permissions drifted from
 * production before.
 */
const GRANTS = `
GRANT ALL ON ALL TABLES    IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

DO $$ BEGIN PERFORM ${PRIVILEGE_MODEL_FN}; END $$;
`

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { stdio: 'inherit', shell: true, ...opts })
}

/**
 * psql inside the DB container, without a shell in between. The SQL goes in
 * on stdin, so its quotes, parentheses and `$` never meet a shell's parser.
 */
function psql(args, opts = {}) {
  return execFileSync(
    'docker',
    ['exec', '-i', DB_CONTAINER, 'psql', LOCAL_DB, '-v', 'ON_ERROR_STOP=1', ...args],
    opts,
  )
}

function privilegeModelInstalled() {
  const out = psql(['-Atc', `SELECT to_regprocedure('${PRIVILEGE_MODEL_FN}') IS NOT NULL`], {
    encoding: 'utf8',
  })
  return out.trim() === 't'
}

function alignGrants() {
  if (!privilegeModelInstalled()) {
    throw new Error(
      `${PRIVILEGE_MODEL_FN} is missing, so this database is behind supabase/migrations. ` +
        'Apply the pending migrations (npx supabase migration up) or rerun with --reset, then run this again. ' +
        'Grants were left untouched.',
    )
  }
  psql(['--single-transaction', '-q', '-f', '-'], {
    input: GRANTS,
    stdio: ['pipe', 'inherit', 'inherit'],
  })
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

  console.log('[local-db] aligning grants with production (hosted grants, then revokes)...')
  alignGrants()

  console.log('\n[local-db] ready.')
  console.log('[local-db] integration tests:')
  console.log('  SUPABASE_DB_POOLER_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres" \\')
  console.log('    pnpm --filter server test:integration')
} finally {
  unpark(parked)
  if (parked) console.log(`[local-db] restored ${BROKEN_MIGRATION}`)
}
