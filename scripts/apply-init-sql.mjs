#!/usr/bin/env node
/**
 * Applies an init.sql file the way the Supabase SQL Editor does, then checks
 * that the install is usable. CI's fresh-install gate runs this against an
 * empty local Supabase database.
 *
 * Why not `psql -f`: psql splits the file into statements and, by default,
 * keeps going after an error, so a broken statement costs one error line and
 * the rest of the schema still lands. The SQL Editor, which the README and
 * /docs/self-host tell people to use, sends the whole file as ONE simple-
 * protocol query. Postgres then treats everything since the last COMMIT as a
 * single implicit transaction: one failing statement rolls all of it back and
 * nothing after it runs. That is how a broken superseded migration left
 * self-hosters without a `requests` table. node-postgres sends a
 * parameterless query exactly that way, so this reproduces the Editor.
 *
 * Usage:
 *   node scripts/apply-init-sql.mjs <connection-url> [file]   (file defaults to supabase/init.sql)
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// Tables the product cannot start without. `requests` sits near the end of
// init.sql, so it is also the canary for "the file stopped partway through".
const REQUIRED_TABLES = [
  'public.organizations',
  'public.org_members',
  'public.projects',
  'public.api_keys',
  'public.provider_keys',
  'public.user_profiles',
  'public.model_prices',
  'public.background_migrations',
  'public.requests',
  'public.requests_fallback',
]

async function main(argv) {
  const [connectionString, fileArg] = argv.slice(2)
  if (!connectionString) {
    console.error('usage: node scripts/apply-init-sql.mjs <connection-url> [file]')
    return 2
  }
  const file = path.resolve(fileArg ?? path.join(root, 'supabase', 'init.sql'))
  const sql = fs.readFileSync(file, 'utf8')

  const client = new pg.Client({ connectionString })
  await client.connect()
  try {
    try {
      await client.query(sql)
    } catch (err) {
      // The connection string carries a password, so only the Postgres error
      // and its position are printed.
      const message = err instanceof Error ? err.message : String(err)
      console.error(`init.sql failed as a single query: ${message}`)
      if (err && typeof err === 'object' && 'position' in err && err.position) {
        const offset = Number(err.position)
        const line = sql.slice(0, offset).split('\n').length
        console.error(`  at ${path.relative(process.cwd(), file)} line ${line}`)
      }
      return 1
    }

    const { rows } = await client.query(
      'SELECT name FROM unnest($1::text[]) AS name WHERE to_regclass(name) IS NULL',
      [REQUIRED_TABLES],
    )
    if (rows.length > 0) {
      console.error(`init.sql ran but these tables are missing: ${rows.map((r) => r.name).join(', ')}`)
      return 1
    }
    console.log(`init.sql applied as one query; ${REQUIRED_TABLES.length} required tables present`)
    return 0
  } finally {
    await client.end()
  }
}

main(process.argv).then(
  (code) => {
    process.exitCode = code
  },
  (err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
  },
)
