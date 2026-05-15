#!/usr/bin/env node
/**
 * Concatenates all supabase/migrations/*.sql files (sorted by name) into
 * supabase/init.sql — a single file self-hosters can run in the Supabase
 * SQL Editor without needing the Supabase CLI.
 *
 * Run after adding a new migration:
 *   node scripts/generate-init-sql.mjs
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const migrationsDir = path.join(root, 'supabase', 'migrations')
const outputFile = path.join(root, 'supabase', 'init.sql')

const files = fs
  .readdirSync(migrationsDir)
  .filter(f => f.endsWith('.sql'))
  .sort()

const header = `-- =============================================================================
-- Spanlens — full database initialisation script
-- =============================================================================
-- Run this once against your Supabase project to create all tables, functions,
-- triggers, RLS policies, and seed data required by Spanlens.
--
-- How to run:
--   Option A (Supabase Dashboard):
--     1. Open your project → SQL Editor → New query
--     2. Paste the entire contents of this file and click Run
--
--   Option B (psql / CI):
--     psql "postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres" \\
--       -f supabase/init.sql
--
-- This file is auto-generated from supabase/migrations/ — do not edit directly.
-- Regenerate with: node scripts/generate-init-sql.mjs
-- =============================================================================

`

const parts = [header]

for (const file of files) {
  const content = fs.readFileSync(path.join(migrationsDir, file), 'utf8').trim()
  parts.push(`
-- -----------------------------------------------------------------------------
-- Migration: ${file}
-- -----------------------------------------------------------------------------
${content}

`)
}

const output = parts.join('')
fs.writeFileSync(outputFile, output, 'utf8')

const lineCount = output.split('\n').length
console.log(`Generated supabase/init.sql — ${files.length} migrations, ${lineCount} lines`)
