import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  MIN_SDK_FOR_SERVER_URL,
  checkServerUrlSupport,
  findInstalledSdkVersion,
  isAtLeast,
} from '../sdk-version.js'
import { writeInstalledSdk } from './helpers/installed-sdk.js'

describe('isAtLeast', () => {
  it('compares numerically, not as strings', () => {
    expect(isAtLeast('0.18.0', '0.18.0')).toBe(true)
    expect(isAtLeast('0.18.1', '0.18.0')).toBe(true)
    expect(isAtLeast('0.20.0', '0.18.0')).toBe(true)
    expect(isAtLeast('1.0.0', '0.18.0')).toBe(true)
    expect(isAtLeast('0.17.9', '0.18.0')).toBe(false)
    expect(isAtLeast('0.9.0', '0.18.0')).toBe(false)
  })

  it('treats a prerelease as older than its release', () => {
    expect(isAtLeast('0.18.0-beta.1', '0.18.0')).toBe(false)
    expect(isAtLeast('0.18.1-beta.1', '0.18.0')).toBe(true)
  })

  it('rejects versions it cannot parse', () => {
    expect(isAtLeast('latest', '0.18.0')).toBe(false)
    expect(isAtLeast('', '0.18.0')).toBe(false)
  })
})

describe('findInstalledSdkVersion / checkServerUrlSupport', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cli-sdk-version-'))
  })
  afterEach(() => {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
  })

  it('reads the version from node_modules', () => {
    writeInstalledSdk(dir, '0.17.0')
    expect(findInstalledSdkVersion(dir)).toBe('0.17.0')
    expect(checkServerUrlSupport(dir)).toEqual({ kind: 'too-old', version: '0.17.0' })
  })

  it('finds a copy hoisted to a parent workspace', () => {
    writeInstalledSdk(dir, MIN_SDK_FOR_SERVER_URL)
    const app = join(dir, 'apps', 'web')
    mkdirSync(app, { recursive: true })
    expect(checkServerUrlSupport(app)).toEqual({ kind: 'supported', version: MIN_SDK_FOR_SERVER_URL })
  })

  it('reports a missing install', () => {
    expect(findInstalledSdkVersion(dir)).toBeNull()
    expect(checkServerUrlSupport(dir)).toEqual({ kind: 'not-installed' })
  })

  it('reports an unreadable package.json as not installed', () => {
    const pkgDir = join(dir, 'node_modules', '@spanlens', 'sdk')
    mkdirSync(pkgDir, { recursive: true })
    writeFileSync(join(pkgDir, 'package.json'), '{ not json')
    expect(checkServerUrlSupport(dir)).toEqual({ kind: 'not-installed' })
  })
})
