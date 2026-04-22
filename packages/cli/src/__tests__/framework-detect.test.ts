import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { detectFramework } from '../framework-detect.js'

describe('detectFramework', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cli-fw-'))
  })
  afterEach(() => {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
  })

  it('detects Next.js with TypeScript', () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        dependencies: { next: '15.0.0' },
        devDependencies: { typescript: '^5.4.0' },
      }),
    )
    const r = detectFramework(dir)
    expect(r.framework).toBe('nextjs')
    expect(r.typescript).toBe(true)
    expect(r.envFile).toBe('.env.local')
  })

  it('detects Next.js JavaScript (no TS)', () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ dependencies: { next: '14.2.0' } }),
    )
    const r = detectFramework(dir)
    expect(r.framework).toBe('nextjs')
    expect(r.typescript).toBe(false)
  })

  it('returns unknown when package.json missing', () => {
    const r = detectFramework(dir)
    expect(r.framework).toBe('unknown')
    expect(r.envFile).toBe('.env')
  })

  it('returns unknown for non-Next projects (even if TS)', () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        devDependencies: { typescript: '^5.0.0' },
      }),
    )
    const r = detectFramework(dir)
    expect(r.framework).toBe('unknown')
    expect(r.typescript).toBe(true)
  })
})
