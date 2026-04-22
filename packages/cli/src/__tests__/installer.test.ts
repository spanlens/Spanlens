import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  detectPackageManager,
  isAlreadyInstalled,
  installPackage,
} from '../installer.js'

describe('detectPackageManager', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pm-test-'))
  })
  afterEach(() => {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
  })

  it('defaults to npm when no lockfile', () => {
    expect(detectPackageManager(dir)).toBe('npm')
  })

  it('detects pnpm via pnpm-lock.yaml', () => {
    writeFileSync(join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n')
    expect(detectPackageManager(dir)).toBe('pnpm')
  })

  it('detects yarn via yarn.lock', () => {
    writeFileSync(join(dir, 'yarn.lock'), '# yarn lockfile v1\n')
    expect(detectPackageManager(dir)).toBe('yarn')
  })

  it('detects bun via bun.lock', () => {
    writeFileSync(join(dir, 'bun.lock'), '{}')
    expect(detectPackageManager(dir)).toBe('bun')
  })

  it('detects bun via legacy bun.lockb', () => {
    writeFileSync(join(dir, 'bun.lockb'), '')
    expect(detectPackageManager(dir)).toBe('bun')
  })

  it('prefers pnpm over npm when both present', () => {
    writeFileSync(join(dir, 'pnpm-lock.yaml'), '')
    writeFileSync(join(dir, 'package-lock.json'), '{}')
    expect(detectPackageManager(dir)).toBe('pnpm')
  })
})

describe('isAlreadyInstalled', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'installed-test-'))
  })
  afterEach(() => {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
  })

  it('returns false when no package.json', () => {
    expect(isAlreadyInstalled(dir, '@spanlens/sdk')).toBe(false)
  })

  it('detects package in dependencies', () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ dependencies: { '@spanlens/sdk': '^0.2.0' } }),
    )
    expect(isAlreadyInstalled(dir, '@spanlens/sdk')).toBe(true)
  })

  it('detects package in devDependencies', () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ devDependencies: { '@spanlens/sdk': '^0.2.0' } }),
    )
    expect(isAlreadyInstalled(dir, '@spanlens/sdk')).toBe(true)
  })

  it('returns false when package not listed', () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ dependencies: { next: '15' } }),
    )
    expect(isAlreadyInstalled(dir, '@spanlens/sdk')).toBe(false)
  })

  it('tolerates malformed package.json', () => {
    writeFileSync(join(dir, 'package.json'), 'not json at all')
    expect(isAlreadyInstalled(dir, '@spanlens/sdk')).toBe(false)
  })
})

describe('installPackage (dryRun)', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'install-test-'))
  })
  afterEach(() => {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
  })

  it('builds correct npm command', async () => {
    const r = await installPackage(dir, 'npm', '@spanlens/sdk', { dryRun: true })
    expect(r.ok).toBe(true)
    expect(r.command).toBe('npm install @spanlens/sdk')
  })

  it('builds correct pnpm command', async () => {
    const r = await installPackage(dir, 'pnpm', '@spanlens/sdk', { dryRun: true })
    expect(r.command).toBe('pnpm add @spanlens/sdk')
  })

  it('builds correct yarn command', async () => {
    const r = await installPackage(dir, 'yarn', '@spanlens/sdk', { dryRun: true })
    expect(r.command).toBe('yarn add @spanlens/sdk')
  })

  it('builds correct bun command', async () => {
    const r = await installPackage(dir, 'bun', '@spanlens/sdk', { dryRun: true })
    expect(r.command).toBe('bun add @spanlens/sdk')
  })
})
