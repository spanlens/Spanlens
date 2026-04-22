import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Detect which framework lives in `cwd`. MVP: Next.js only; returns
 * `null` when the project doesn't look like a supported framework.
 */

export type Framework = 'nextjs' | 'unknown'

export interface FrameworkInfo {
  framework: Framework
  typescript: boolean
  envFile: string // preferred env file to write to
}

interface PackageJsonShape {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

export function detectFramework(cwd: string = process.cwd()): FrameworkInfo {
  const pkgPath = resolve(cwd, 'package.json')
  if (!existsSync(pkgPath)) {
    return { framework: 'unknown', typescript: false, envFile: '.env' }
  }

  let pkg: PackageJsonShape
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as PackageJsonShape
  } catch {
    return { framework: 'unknown', typescript: false, envFile: '.env' }
  }

  const deps = { ...pkg.dependencies, ...pkg.devDependencies }

  const hasNext = typeof deps['next'] === 'string'
  const hasTypescript = typeof deps['typescript'] === 'string'

  if (hasNext) {
    return {
      framework: 'nextjs',
      typescript: hasTypescript,
      envFile: '.env.local', // Next.js convention
    }
  }

  return {
    framework: 'unknown',
    typescript: hasTypescript,
    envFile: '.env',
  }
}
