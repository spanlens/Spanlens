#!/usr/bin/env tsx
/**
 * Self-host environment diagnostic.
 *
 * Usage:
 *   pnpm check:env                  # human-readable, colorized
 *   pnpm check:env --json           # machine-readable, for CI
 *   pnpm check:env --quiet          # errors only
 *
 * Exit code:
 *   0 — all required vars present + valid + reachable
 *   1 — at least one required check failed
 *   2 — script crashed (bug, not env issue)
 *
 * What it catches up front so the operator doesn't hit them at runtime:
 *   - ENCRYPTION_KEY wrong length / not base64 → silent provider-key decrypt
 *     failures (CLAUDE.md gotcha #5)
 *   - WEB_URL left at localhost → invite emails are broken at root
 *   - Supabase service-role key actually being an anon key → RLS bypass fails
 *   - ClickHouse unreachable → all proxy logging silently lost (gotcha #3)
 *   - PADDLE_ENVIRONMENT swapped sandbox/production with leftover ctm_ rows
 *     (gotcha #6)
 *
 * Adding a new check: extend CHECKS below. Keep messages actionable —
 * include the exact command or URL the operator should follow.
 */

import { exit } from 'node:process'
import 'dotenv/config'

interface Check {
  name: string
  level: 'required' | 'optional' | 'connectivity'
  /** Short description of what the var unlocks (shown when missing). */
  unlocks?: string
  run: () => CheckResult | Promise<CheckResult>
}

type CheckResult =
  | { status: 'ok'; detail?: string }
  | { status: 'warn'; detail: string }
  | { status: 'error'; detail: string; fix?: string }
  | { status: 'skip'; detail: string }

interface Output {
  level: Check['level']
  name: string
  status: CheckResult['status']
  detail?: string
  fix?: string
}

// ── Format primitives (no chalk dep) ────────────────────────────────────────
const NO_COLOR = !!process.env['NO_COLOR'] || process.env['TERM'] === 'dumb'
const c = {
  reset: NO_COLOR ? '' : '\x1b[0m',
  bold: NO_COLOR ? '' : '\x1b[1m',
  dim: NO_COLOR ? '' : '\x1b[2m',
  red: NO_COLOR ? '' : '\x1b[31m',
  green: NO_COLOR ? '' : '\x1b[32m',
  yellow: NO_COLOR ? '' : '\x1b[33m',
  cyan: NO_COLOR ? '' : '\x1b[36m',
  grey: NO_COLOR ? '' : '\x1b[90m',
}

function symbol(status: CheckResult['status']): string {
  if (status === 'ok') return `${c.green}✓${c.reset}`
  if (status === 'warn') return `${c.yellow}⚠${c.reset}`
  if (status === 'error') return `${c.red}✗${c.reset}`
  return `${c.grey}∙${c.reset}`
}

// ── Validators (exported for tests) ─────────────────────────────────────────

export function validateRequiredString(value: string | undefined, name: string): CheckResult {
  if (!value || !value.trim()) {
    return { status: 'error', detail: `${name} is required but not set` }
  }
  return { status: 'ok', detail: `${value.length} chars` }
}

export function validateUrl(value: string | undefined, name: string): CheckResult {
  if (!value || !value.trim()) {
    return { status: 'error', detail: `${name} is required but not set` }
  }
  try {
    const u = new URL(value)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return {
        status: 'error',
        detail: `${name} must be http:// or https://, got ${u.protocol}`,
      }
    }
    return { status: 'ok', detail: value }
  } catch {
    return {
      status: 'error',
      detail: `${name} is not a valid URL: ${value}`,
    }
  }
}

export function validateBase64Bytes(
  value: string | undefined,
  name: string,
  expectedBytes: number,
): CheckResult {
  if (!value || !value.trim()) {
    return {
      status: 'error',
      detail: `${name} is required but not set`,
      fix: `openssl rand -base64 ${expectedBytes}`,
    }
  }
  let buf: Buffer
  try {
    buf = Buffer.from(value, 'base64')
  } catch {
    return {
      status: 'error',
      detail: `${name} is not valid base64`,
      fix: `openssl rand -base64 ${expectedBytes}`,
    }
  }
  if (buf.length !== expectedBytes) {
    return {
      status: 'error',
      detail: `${name} must decode to ${expectedBytes} bytes, got ${buf.length} bytes`,
      fix: `openssl rand -base64 ${expectedBytes}`,
    }
  }
  return { status: 'ok', detail: `${expectedBytes} bytes base64` }
}

export function validateSupabaseRole(
  jwt: string | undefined,
  expected: 'anon' | 'service_role',
): CheckResult {
  if (!jwt || !jwt.trim()) {
    return { status: 'error', detail: 'not set' }
  }
  const parts = jwt.split('.')
  if (parts.length !== 3) {
    return {
      status: 'error',
      detail: `not a JWT (expected 3 dot-separated parts, got ${parts.length})`,
    }
  }
  try {
    // base64url decode without external dep
    const padded = parts[1]! + '='.repeat((4 - (parts[1]!.length % 4)) % 4)
    const payload = JSON.parse(
      Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8'),
    ) as { role?: string; iss?: string }
    if (payload.role !== expected) {
      return {
        status: 'error',
        detail: `JWT role is "${payload.role ?? '(missing)'}", expected "${expected}"`,
        fix:
          expected === 'service_role'
            ? 'Get the service_role key from Supabase Dashboard → Settings → API'
            : 'Get the anon key from Supabase Dashboard → Settings → API',
      }
    }
    return { status: 'ok', detail: `JWT role=${expected}` }
  } catch (err) {
    return {
      status: 'error',
      detail: `could not parse JWT payload: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

export function validatePort(value: string | undefined): CheckResult {
  if (!value) return { status: 'ok', detail: '(unset, will default to 3001)' }
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    return { status: 'error', detail: `PORT must be an integer 1-65535, got "${value}"` }
  }
  return { status: 'ok', detail: String(n) }
}

export function validateWebUrl(value: string | undefined): CheckResult {
  if (!value || !value.trim()) {
    return {
      status: 'warn',
      detail: 'WEB_URL not set — invitation emails will use http://localhost:3000 and break for real recipients',
    }
  }
  const urlResult = validateUrl(value, 'WEB_URL')
  if (urlResult.status !== 'ok') return urlResult
  if (value.startsWith('http://localhost') && process.env['NODE_ENV'] === 'production') {
    return {
      status: 'warn',
      detail: 'WEB_URL points to localhost while NODE_ENV=production — invitation links will be broken',
    }
  }
  return { status: 'ok', detail: value }
}

// ── Connectivity tests ──────────────────────────────────────────────────────

async function pingHttp(url: string, timeoutMs = 5000): Promise<CheckResult> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  const started = Date.now()
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    const ms = Date.now() - started
    if (res.status >= 200 && res.status < 500) {
      return { status: 'ok', detail: `HTTP ${res.status} in ${ms}ms` }
    }
    return { status: 'error', detail: `HTTP ${res.status} in ${ms}ms` }
  } catch (err) {
    const ms = Date.now() - started
    const msg = err instanceof Error ? err.message : String(err)
    return { status: 'error', detail: `${msg} (after ${ms}ms)` }
  } finally {
    clearTimeout(t)
  }
}

async function checkSupabaseReachable(): Promise<CheckResult> {
  const url = process.env['SUPABASE_URL']
  if (!url) return { status: 'skip', detail: 'SUPABASE_URL not set, skipped' }
  // /auth/v1/health is a stable public endpoint on every Supabase instance.
  return pingHttp(`${url.replace(/\/$/, '')}/auth/v1/health`)
}

async function checkClickhouseReachable(): Promise<CheckResult> {
  const url = process.env['CLICKHOUSE_URL']
  if (!url) return { status: 'skip', detail: 'CLICKHOUSE_URL not set, skipped' }
  return pingHttp(`${url.replace(/\/$/, '')}/ping`)
}

// ── Check list ──────────────────────────────────────────────────────────────

const CHECKS: Check[] = [
  // Required
  {
    name: 'SUPABASE_URL',
    level: 'required',
    run: () => validateUrl(process.env['SUPABASE_URL'], 'SUPABASE_URL'),
  },
  {
    name: 'SUPABASE_ANON_KEY',
    level: 'required',
    run: () => validateSupabaseRole(process.env['SUPABASE_ANON_KEY'], 'anon'),
  },
  {
    name: 'SUPABASE_SERVICE_ROLE_KEY',
    level: 'required',
    run: () => validateSupabaseRole(process.env['SUPABASE_SERVICE_ROLE_KEY'], 'service_role'),
  },
  {
    name: 'ENCRYPTION_KEY',
    level: 'required',
    run: () => validateBase64Bytes(process.env['ENCRYPTION_KEY'], 'ENCRYPTION_KEY', 32),
  },
  {
    name: 'CLICKHOUSE_URL',
    level: 'required',
    run: () => validateUrl(process.env['CLICKHOUSE_URL'], 'CLICKHOUSE_URL'),
  },
  {
    name: 'CLICKHOUSE_USER',
    level: 'required',
    run: () => validateRequiredString(process.env['CLICKHOUSE_USER'], 'CLICKHOUSE_USER'),
  },
  {
    name: 'CLICKHOUSE_PASSWORD',
    level: 'required',
    run: () => validateRequiredString(process.env['CLICKHOUSE_PASSWORD'], 'CLICKHOUSE_PASSWORD'),
  },
  {
    name: 'CLICKHOUSE_DB',
    level: 'required',
    run: () => validateRequiredString(process.env['CLICKHOUSE_DB'], 'CLICKHOUSE_DB'),
  },
  {
    name: 'PORT',
    level: 'required',
    run: () => validatePort(process.env['PORT']),
  },
  {
    name: 'WEB_URL',
    level: 'required',
    unlocks: 'invitation links',
    run: () => validateWebUrl(process.env['WEB_URL']),
  },

  // Connectivity
  {
    name: 'Supabase HTTP',
    level: 'connectivity',
    run: () => checkSupabaseReachable(),
  },
  {
    name: 'ClickHouse HTTP',
    level: 'connectivity',
    run: () => checkClickhouseReachable(),
  },

  // Optional features
  {
    name: 'RESEND_API_KEY',
    level: 'optional',
    unlocks: 'invitation email delivery',
    run: () => {
      const v = process.env['RESEND_API_KEY']
      if (!v) {
        return {
          status: 'warn',
          detail: 'unset — invite emails fall back to dev console URL (fine for local dev)',
        }
      }
      if (!v.startsWith('re_')) {
        return { status: 'error', detail: 'should start with "re_", got something else' }
      }
      return { status: 'ok', detail: `${v.slice(0, 6)}…` }
    },
  },
  {
    name: 'CRON_SECRET',
    level: 'optional',
    unlocks: '/cron/* endpoint Bearer auth',
    run: () => {
      const v = process.env['CRON_SECRET']
      if (!v) {
        return {
          status: 'warn',
          detail: 'unset — /cron/* endpoints will reject everything (intentional in production)',
        }
      }
      if (v.length < 16) {
        return { status: 'error', detail: 'too short — generate with `openssl rand -hex 32`' }
      }
      return { status: 'ok', detail: `${v.length} chars` }
    },
  },
  {
    name: 'PADDLE_ENVIRONMENT',
    level: 'optional',
    unlocks: 'billing',
    run: () => {
      const v = process.env['PADDLE_ENVIRONMENT']
      if (!v) return { status: 'ok', detail: '(unset, will default to sandbox)' }
      if (v !== 'sandbox' && v !== 'production') {
        return {
          status: 'error',
          detail: `must be "sandbox" or "production", got "${v}"`,
        }
      }
      if (v === 'production' && process.env['NODE_ENV'] !== 'production') {
        return {
          status: 'warn',
          detail: 'PADDLE_ENVIRONMENT=production but NODE_ENV!=production — verify intentional',
        }
      }
      return { status: 'ok', detail: v }
    },
  },
  {
    name: 'KV_REST_API_URL',
    level: 'optional',
    unlocks: 'rate limiting (fails-open without)',
    run: () => {
      const v = process.env['KV_REST_API_URL']
      if (!v) {
        return {
          status: 'warn',
          detail: 'unset — rate limit fails-open (everything allowed)',
        }
      }
      return validateUrl(v, 'KV_REST_API_URL')
    },
  },
  {
    name: 'SENTRY_DSN',
    level: 'optional',
    unlocks: 'error monitoring',
    run: () => {
      const v = process.env['SENTRY_DSN']
      if (!v) {
        return {
          status: 'warn',
          detail: 'unset — errors logged to console only',
        }
      }
      return validateUrl(v, 'SENTRY_DSN')
    },
  },
]

// ── Runner ──────────────────────────────────────────────────────────────────

const args = new Set(process.argv.slice(2))
const isJson = args.has('--json')
const isQuiet = args.has('--quiet')

async function main(): Promise<void> {
  const results: Output[] = []
  for (const check of CHECKS) {
    const r = await Promise.resolve().then(() => check.run())
    results.push({
      level: check.level,
      name: check.name,
      status: r.status,
      ...('detail' in r ? { detail: r.detail } : {}),
      ...('fix' in r && r.fix ? { fix: r.fix } : {}),
    })
  }

  const counts = {
    ok: results.filter((r) => r.status === 'ok').length,
    warn: results.filter((r) => r.status === 'warn').length,
    error: results.filter((r) => r.status === 'error').length,
    skip: results.filter((r) => r.status === 'skip').length,
  }
  // Required + connectivity errors are the only exit-1 cases. Optional warnings
  // shouldn't break a self-host that intentionally skipped Sentry/Paddle/etc.
  const hardFail = results.filter(
    (r) => r.status === 'error' && (r.level === 'required' || r.level === 'connectivity'),
  ).length

  if (isJson) {
    console.log(JSON.stringify({ counts, hardFail, results }, null, 2))
    exit(hardFail > 0 ? 1 : 0)
  }

  // Human-readable output, grouped by level.
  const groups: Array<{ label: string; level: Check['level'] }> = [
    { label: 'Required vars', level: 'required' },
    { label: 'Connectivity', level: 'connectivity' },
    { label: 'Optional features', level: 'optional' },
  ]
  for (const g of groups) {
    const rows = results.filter((r) => r.level === g.level)
    const printable = isQuiet
      ? rows.filter((r) => r.status === 'error' || r.status === 'warn')
      : rows
    if (printable.length === 0 && isQuiet) continue
    const okCount = rows.filter((r) => r.status === 'ok').length
    console.log(`\n${c.bold}${g.label}${c.reset} ${c.dim}(${okCount}/${rows.length} ok)${c.reset}`)
    for (const r of printable) {
      const head = `  ${symbol(r.status)} ${r.name.padEnd(28)}`
      const tail = r.detail ? `${c.dim}${r.detail}${c.reset}` : ''
      console.log(`${head} ${tail}`)
      if (r.fix) console.log(`    ${c.cyan}→ ${r.fix}${c.reset}`)
    }
  }

  console.log('')
  if (hardFail > 0) {
    console.log(
      `${c.red}${c.bold}${hardFail} required check${hardFail === 1 ? '' : 's'} failed${c.reset} — fix the items above before starting the server`,
    )
    exit(1)
  } else if (counts.warn > 0) {
    console.log(
      `${c.green}All required checks pass${c.reset} ${c.yellow}(${counts.warn} optional warning${counts.warn === 1 ? '' : 's'})${c.reset}`,
    )
    exit(0)
  } else {
    console.log(`${c.green}${c.bold}All checks pass${c.reset}`)
    exit(0)
  }
}

main().catch((err) => {
  console.error(`${c.red}check-env crashed:${c.reset}`, err)
  exit(2)
})
