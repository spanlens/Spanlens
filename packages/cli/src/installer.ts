import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'

/**
 * Package manager detection + install helpers.
 *
 * Spanlens CLI is delivered via `npx`, which means its own node_modules
 * is ephemeral and completely separate from the user's project. So adding
 * `@spanlens/sdk` as a CLI dependency does NOT expose it to the user's
 * app — we have to run the user's package manager against their cwd.
 */

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun'

interface PackageJsonShape {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

/**
 * Detect which package manager the user's project uses.
 * Lockfile → manager, falls back to npm.
 */
export function detectPackageManager(cwd: string): PackageManager {
  if (existsSync(resolve(cwd, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(resolve(cwd, 'yarn.lock'))) return 'yarn'
  if (existsSync(resolve(cwd, 'bun.lock'))) return 'bun'
  if (existsSync(resolve(cwd, 'bun.lockb'))) return 'bun'
  return 'npm'
}

/**
 * Is `pkg` already listed in the user's package.json (deps or devDeps)?
 * We only check manifest — not whether node_modules is populated — so a
 * stale package.json without `npm install` yet will still register as
 * "installed" and we skip. That's intentional: we never want to re-write
 * manifest when the user already opted in.
 */
export function isAlreadyInstalled(cwd: string, pkg: string): boolean {
  const pkgJsonPath = resolve(cwd, 'package.json')
  if (!existsSync(pkgJsonPath)) return false
  try {
    const parsed = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as PackageJsonShape
    return Boolean(parsed.dependencies?.[pkg] ?? parsed.devDependencies?.[pkg])
  } catch {
    return false
  }
}

function installArgs(pm: PackageManager, pkg: string): string[] {
  switch (pm) {
    case 'npm': return ['install', pkg]
    case 'pnpm': return ['add', pkg]
    case 'yarn': return ['add', pkg]
    case 'bun': return ['add', pkg]
  }
}

export interface InstallOptions {
  /** If true, just return the command that would be run — no spawn. */
  dryRun?: boolean
  /** Capture stdout/stderr instead of inheriting (useful for programmatic callers). */
  silent?: boolean
}

export interface InstallResult {
  ok: boolean
  command: string // human-readable for UI
  error?: string
}

/**
 * Install `pkg` using the detected package manager in `cwd`. Inherits
 * stdio by default so users see install progress in real time.
 *
 * On Windows, spawning package managers needs `shell: true` because the
 * binaries are often `.cmd` shims — without shell they fail with ENOENT.
 */
export async function installPackage(
  cwd: string,
  pm: PackageManager,
  pkg: string,
  opts: InstallOptions = {},
): Promise<InstallResult> {
  const args = installArgs(pm, pkg)
  const command = `${pm} ${args.join(' ')}`

  if (opts.dryRun) {
    return { ok: true, command }
  }

  return new Promise<InstallResult>((resolvePromise) => {
    const child = spawn(pm, args, {
      cwd,
      stdio: opts.silent ? 'pipe' : 'inherit',
      shell: process.platform === 'win32',
    })

    let stderr = ''
    if (opts.silent && child.stderr) {
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
      })
    }

    child.on('error', (err) => {
      resolvePromise({ ok: false, command, error: err.message })
    })

    child.on('close', (code) => {
      if (code === 0) {
        resolvePromise({ ok: true, command })
      } else {
        resolvePromise({
          ok: false,
          command,
          error: `${pm} exited with code ${code}${stderr ? `: ${stderr.slice(0, 200)}` : ''}`,
        })
      }
    })
  })
}
