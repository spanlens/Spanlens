import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/**
 * Which `@spanlens/sdk` the user's project will actually load.
 *
 * `--server-url` writes SPANLENS_BASE_URL, but only SDK releases that read
 * that variable honour it. An older SDK falls back to the hosted
 * https://api.spanlens.io, so the self-hosted key and every prompt would go
 * to the hosted service. The wizard checks the installed version before it
 * claims otherwise.
 */

export const SDK_PACKAGE = '@spanlens/sdk'

/** First @spanlens/sdk release whose factories read SPANLENS_BASE_URL. */
export const MIN_SDK_FOR_SERVER_URL = '0.18.0'

export type ServerUrlSupport =
  | { kind: 'supported'; version: string }
  | { kind: 'too-old'; version: string }
  | { kind: 'not-installed' }

export function checkServerUrlSupport(cwd: string): ServerUrlSupport {
  const version = findInstalledSdkVersion(cwd)
  if (version === null) return { kind: 'not-installed' }
  return isAtLeast(version, MIN_SDK_FOR_SERVER_URL) ? { kind: 'supported', version } : { kind: 'too-old', version }
}

/**
 * Version of the `@spanlens/sdk` that Node resolves from `cwd`: the nearest
 * `node_modules/@spanlens/sdk` walking up, so a copy hoisted to a workspace
 * root counts. Null when there is none or its package.json is unreadable.
 */
export function findInstalledSdkVersion(cwd: string): string | null {
  let dir = resolve(cwd)
  for (;;) {
    const version = readVersion(join(dir, 'node_modules', SDK_PACKAGE, 'package.json'))
    if (version !== undefined) return version
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/** undefined = no file there (keep walking), null = file present but unusable. */
function readVersion(pkgJsonPath: string): string | null | undefined {
  let text: string
  try {
    text = readFileSync(pkgJsonPath, 'utf8')
  } catch {
    return undefined
  }
  try {
    const parsed = JSON.parse(text) as { version?: unknown }
    return typeof parsed.version === 'string' ? parsed.version : null
  } catch {
    return null
  }
}

/** Semver `version >= min`. A prerelease sorts before its release; unparsable versions fail. */
export function isAtLeast(version: string, min: string): boolean {
  const a = parseVersion(version)
  const b = parseVersion(min)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) {
    if (a.core[i]! !== b.core[i]!) return a.core[i]! > b.core[i]!
  }
  return !a.prerelease || Boolean(b.prerelease)
}

function parseVersion(version: string): { core: [number, number, number]; prerelease: boolean } | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/.exec(version.trim())
  if (!match) return null
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], prerelease: match[4] !== undefined }
}
