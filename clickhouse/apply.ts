#!/usr/bin/env tsx
/**
 * ClickHouse migration runner.
 *
 * Reads every .sql file in ./migrations/ (sorted lexicographically) and
 * executes its statements against the configured CLICKHOUSE_URL. All
 * migrations are expected to be idempotent — CREATE IF NOT EXISTS / ALTER
 * ADD COLUMN IF NOT EXISTS — so running this repeatedly is safe.
 *
 * Usage:  pnpm ch:migrate
 *
 * Env vars (loaded from apps/server/.env if present):
 *   CLICKHOUSE_URL       e.g. http://localhost:8123
 *   CLICKHOUSE_USER      e.g. spanlens
 *   CLICKHOUSE_PASSWORD  required
 *   CLICKHOUSE_DB        default 'spanlens'
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@clickhouse/client'
import { config as loadDotenv } from 'dotenv'

const __dirname = dirname(fileURLToPath(import.meta.url))

interface MigrationEnv {
  url: string
  username: string
  password: string
  database: string
}

function loadEnv(): MigrationEnv {
  // Load apps/server/.env if it exists so devs can run `pnpm ch:migrate`
  // without exporting variables manually.
  const envPath = join(__dirname, '..', 'apps', 'server', '.env')
  if (existsSync(envPath)) loadDotenv({ path: envPath })

  const url = process.env['CLICKHOUSE_URL']
  const username = process.env['CLICKHOUSE_USER']
  const password = process.env['CLICKHOUSE_PASSWORD']
  const database = process.env['CLICKHOUSE_DB'] ?? 'spanlens'

  if (!url || !username || !password) {
    throw new Error(
      'CLICKHOUSE_URL, CLICKHOUSE_USER, and CLICKHOUSE_PASSWORD must all be set. ' +
        'See apps/server/.env.example.',
    )
  }
  return { url, username, password, database }
}

/** Splits a SQL file into individual statements, ignoring `--` line comments. */
function splitStatements(sql: string): string[] {
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

async function main(): Promise<void> {
  const env = loadEnv()
  const migrationsDir = join(__dirname, 'migrations')
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  if (files.length === 0) {
    console.log('No migrations to apply.')
    return
  }

  // Connect WITHOUT a default database first so we can create it if missing.
  const bootstrap = createClient({
    url: env.url,
    username: env.username,
    password: env.password,
  })
  await bootstrap.command({ query: `CREATE DATABASE IF NOT EXISTS ${env.database}` })
  await bootstrap.close()

  const client = createClient({
    url: env.url,
    username: env.username,
    password: env.password,
    database: env.database,
  })

  try {
    for (const file of files) {
      const sql = readFileSync(join(migrationsDir, file), 'utf-8')
      const statements = splitStatements(sql)
      console.log(`▶ ${file} (${statements.length} statement${statements.length === 1 ? '' : 's'})`)
      for (const statement of statements) {
        await client.command({ query: statement })
      }
    }
    console.log(`✓ Applied ${files.length} migration${files.length === 1 ? '' : 's'} to "${env.database}".`)
  } finally {
    await client.close()
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : 'Unknown error'
  console.error(`✗ Migration failed: ${message}`)
  process.exit(1)
})
