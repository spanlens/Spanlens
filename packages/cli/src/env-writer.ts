import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Idempotently add (or update) a KEY=VALUE line to an env file.
 *
 * - Preserves existing lines and comments.
 * - If KEY already exists, replaces its value.
 * - If the file doesn't exist, creates it.
 * - Returns true if the file changed.
 */
export function upsertEnvVar(
  cwd: string,
  filename: string,
  key: string,
  value: string,
): { changed: boolean; created: boolean; existed: boolean } {
  const path = resolve(cwd, filename)
  const existed = existsSync(path)
  const existing = existed ? readFileSync(path, 'utf8') : ''

  const lines = existing ? existing.split(/\r?\n/) : []
  const pattern = new RegExp(`^${escapeRegex(key)}\\s*=`)
  let found = false
  let valueChanged = false

  const updated = lines.map((line) => {
    if (pattern.test(line)) {
      found = true
      const newLine = `${key}=${value}`
      if (line !== newLine) valueChanged = true
      return newLine
    }
    return line
  })

  if (!found) {
    // Ensure terminating newline before appending
    if (updated.length > 0 && updated[updated.length - 1] !== '') {
      updated.push('')
    }
    updated.push(`${key}=${value}`)
    updated.push('') // trailing newline
  }

  const nextText = updated.join('\n')
  if (nextText === existing) {
    return { changed: false, created: false, existed }
  }
  writeFileSync(path, nextText, 'utf8')
  return { changed: found ? valueChanged : true, created: !existed, existed }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
