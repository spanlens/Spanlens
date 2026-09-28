import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { InstallOptions, InstallResult, PackageManager } from '../installer.js'
import { declareSdkDependency, writeInstalledSdk } from './helpers/installed-sdk.js'

// The prompts are interactive: answer from a queue and record what is printed.
const printed: string[] = []
const answers: unknown[] = []
vi.mock('@clack/prompts', () => {
  const record = (msg: unknown): void => { printed.push(String(msg)) }
  return {
    confirm: vi.fn(async () => answers.shift() ?? true),
    isCancel: () => false,
    spinner: () => ({ start: record, stop: record }),
    log: { message: record, warn: record, error: record, info: record, success: record, step: record },
  }
})

const { runSdkStep } = await import('../sdk-step.js')
const { MIN_SDK_FOR_SERVER_URL } = await import('../sdk-version.js')

/**
 * C15.2: a self-hosted setup is only safe when the installed @spanlens/sdk
 * reads SPANLENS_BASE_URL. An older SDK silently sends the self-hosted key
 * and every prompt to the hosted service, so the wizard must upgrade it or
 * stop before it patches any code.
 */

const SERVER = 'https://spanlens.example.com'

interface InstallCall { pkg: string; dryRun: boolean }

function fakeInstaller(dir: string, installs: string | null) {
  const calls: InstallCall[] = []
  const install = async (
    _cwd: string,
    pm: PackageManager,
    pkg: string,
    opts: InstallOptions = {},
  ): Promise<InstallResult> => {
    calls.push({ pkg, dryRun: opts.dryRun === true })
    const command = `${pm} add ${pkg}`
    if (opts.dryRun) return { ok: true, command }
    if (installs === null) return { ok: false, command, error: 'network down' }
    writeInstalledSdk(dir, installs)
    return { ok: true, command }
  }
  return { install, calls }
}

describe('runSdkStep', () => {
  let dir: string
  beforeEach(() => {
    printed.length = 0
    answers.length = 0
    dir = mkdtempSync(join(tmpdir(), 'cli-sdk-step-'))
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fixture', private: true }))
  })
  afterEach(() => {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
  })

  it('does not check the version for the hosted service', async () => {
    declareSdkDependency(dir)
    writeInstalledSdk(dir, '0.10.0')
    const { install, calls } = fakeInstaller(dir, null)
    const result = await runSdkStep({ cwd: dir, pm: 'pnpm', dryRun: false, serverUrl: null }, { install })
    expect(result).toEqual({ kind: 'continue', readsServerUrl: false })
    expect(calls).toEqual([])
  })

  it('continues when the installed SDK already reads SPANLENS_BASE_URL', async () => {
    declareSdkDependency(dir)
    writeInstalledSdk(dir, MIN_SDK_FOR_SERVER_URL)
    const { install, calls } = fakeInstaller(dir, null)
    const result = await runSdkStep({ cwd: dir, pm: 'pnpm', dryRun: false, serverUrl: SERVER }, { install })
    expect(result).toEqual({ kind: 'continue', readsServerUrl: true })
    expect(calls).toEqual([])
  })

  it('upgrades an SDK that ignores SPANLENS_BASE_URL', async () => {
    declareSdkDependency(dir)
    writeInstalledSdk(dir, '0.17.0')
    const { install, calls } = fakeInstaller(dir, MIN_SDK_FOR_SERVER_URL)
    const result = await runSdkStep({ cwd: dir, pm: 'pnpm', dryRun: false, serverUrl: SERVER }, { install })
    expect(result).toEqual({ kind: 'continue', readsServerUrl: true })
    expect(calls).toEqual([{ pkg: '@spanlens/sdk@latest', dryRun: false }])
    expect(printed.join('\n')).toContain('0.17.0')
  })

  it('stops when the user declines the upgrade', async () => {
    declareSdkDependency(dir)
    writeInstalledSdk(dir, '0.17.0')
    answers.push(false)
    const { install, calls } = fakeInstaller(dir, MIN_SDK_FOR_SERVER_URL)
    const result = await runSdkStep({ cwd: dir, pm: 'npm', dryRun: false, serverUrl: SERVER }, { install })
    expect(calls).toEqual([])
    expect(result.kind).toBe('stop')
    const message = result.kind === 'stop' ? result.message : ''
    expect(message).toContain(MIN_SDK_FOR_SERVER_URL)
    expect(message).toContain('hosted service')
    expect(message).not.toContain(String.fromCharCode(0x2014))
  })

  it('stops when the latest published SDK still ignores SPANLENS_BASE_URL', async () => {
    declareSdkDependency(dir)
    writeInstalledSdk(dir, '0.17.0')
    const { install } = fakeInstaller(dir, '0.17.1')
    const result = await runSdkStep({ cwd: dir, pm: 'pnpm', dryRun: false, serverUrl: SERVER }, { install })
    expect(result.kind).toBe('stop')
    expect(result.kind === 'stop' ? result.message : '').toContain('0.17.1')
  })

  it('stops when the upgrade fails', async () => {
    declareSdkDependency(dir)
    writeInstalledSdk(dir, '0.17.0')
    const { install } = fakeInstaller(dir, null)
    const result = await runSdkStep({ cwd: dir, pm: 'pnpm', dryRun: false, serverUrl: SERVER }, { install })
    expect(result.kind).toBe('stop')
  })

  it('checks a fresh install for a self-hosted setup', async () => {
    const { install, calls } = fakeInstaller(dir, '0.17.0')
    const result = await runSdkStep({ cwd: dir, pm: 'pnpm', dryRun: false, serverUrl: SERVER }, { install })
    expect(calls[0]).toEqual({ pkg: '@spanlens/sdk', dryRun: false })
    expect(result.kind).toBe('stop')
  })

  it('continues without the claim when the install was skipped', async () => {
    answers.push(false)
    const { install, calls } = fakeInstaller(dir, MIN_SDK_FOR_SERVER_URL)
    const result = await runSdkStep({ cwd: dir, pm: 'pnpm', dryRun: false, serverUrl: SERVER }, { install })
    expect(calls).toEqual([])
    expect(result).toEqual({ kind: 'continue', readsServerUrl: false })
    expect(printed.join('\n')).toContain(MIN_SDK_FOR_SERVER_URL)
  })

  it('warns without the claim when the declared SDK is not in node_modules', async () => {
    declareSdkDependency(dir)
    const { install, calls } = fakeInstaller(dir, MIN_SDK_FOR_SERVER_URL)
    const result = await runSdkStep({ cwd: dir, pm: 'pnpm', dryRun: false, serverUrl: SERVER }, { install })
    expect(calls).toEqual([])
    expect(result).toEqual({ kind: 'continue', readsServerUrl: false })
    expect(printed.join('\n')).toContain('node_modules')
  })

  it('does not claim support on a dry run', async () => {
    declareSdkDependency(dir)
    const { install } = fakeInstaller(dir, MIN_SDK_FOR_SERVER_URL)
    const result = await runSdkStep({ cwd: dir, pm: 'pnpm', dryRun: true, serverUrl: SERVER }, { install })
    expect(result).toEqual({ kind: 'continue', readsServerUrl: false })
  })
})
