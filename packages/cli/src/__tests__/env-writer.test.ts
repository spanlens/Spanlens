import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { upsertEnvVar } from '../env-writer.js'

describe('upsertEnvVar', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cli-test-'))
  })
  afterEach(() => {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
  })

  it('creates a new env file', () => {
    const r = upsertEnvVar(dir, '.env.local', 'SPANLENS_API_KEY', 'sl_live_x')
    expect(r.created).toBe(true)
    expect(r.changed).toBe(true)
    expect(readFileSync(join(dir, '.env.local'), 'utf8')).toBe(
      'SPANLENS_API_KEY=sl_live_x\n',
    )
  })

  it('appends to existing file without touching other keys', () => {
    writeFileSync(join(dir, '.env.local'), 'OTHER=keep\n# comment\n')
    const r = upsertEnvVar(dir, '.env.local', 'SPANLENS_API_KEY', 'sl_live_x')
    expect(r.created).toBe(false)
    expect(r.changed).toBe(true)
    const out = readFileSync(join(dir, '.env.local'), 'utf8')
    expect(out).toContain('OTHER=keep')
    expect(out).toContain('# comment')
    expect(out).toContain('SPANLENS_API_KEY=sl_live_x')
  })

  it('replaces existing value when key already present', () => {
    writeFileSync(join(dir, '.env.local'), 'SPANLENS_API_KEY=old\nOTHER=keep\n')
    const r = upsertEnvVar(dir, '.env.local', 'SPANLENS_API_KEY', 'sl_live_new')
    expect(r.changed).toBe(true)
    const out = readFileSync(join(dir, '.env.local'), 'utf8')
    expect(out).toContain('SPANLENS_API_KEY=sl_live_new')
    expect(out).not.toContain('SPANLENS_API_KEY=old')
    expect(out).toContain('OTHER=keep')
  })

  it('reports no change when value already matches', () => {
    writeFileSync(join(dir, '.env.local'), 'SPANLENS_API_KEY=sl_live_x\n')
    const r = upsertEnvVar(dir, '.env.local', 'SPANLENS_API_KEY', 'sl_live_x')
    expect(r.changed).toBe(false)
  })
})
