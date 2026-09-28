import { chmodSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

/**
 * Transactional file writes for the code patcher. Every file is written via
 * a temp file + rename so a crash never leaves half a source file behind,
 * and the set of writes is all-or-nothing: if one write fails, the files
 * already written are restored before the error surfaces. The returned
 * backups let the caller roll the whole patch back later (for example when
 * the post-patch type check fails).
 */

export interface FileBackup {
  filepath: string
  original: string
}

export interface PendingWrite extends FileBackup {
  text: string
}

export interface RestoreReport {
  restored: string[]
  failed: { filepath: string; error: string }[]
}

export type FileWriter = (filepath: string, text: string) => void

export class PatchWriteError extends Error {
  readonly filepath: string
  readonly restore: RestoreReport

  constructor(filepath: string, cause: unknown, restore: RestoreReport) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    super(`Could not write ${filepath} (${detail}). Files written before it were restored.`)
    this.name = 'PatchWriteError'
    this.filepath = filepath
    this.restore = restore
  }
}

export function writeFileAtomic(filepath: string, text: string): void {
  const target = resolveTarget(filepath)
  const tmp = join(dirname(target), `.${basename(target)}.spanlens-${process.pid}.tmp`)
  writeFileSync(tmp, text, 'utf8')
  try {
    try {
      chmodSync(tmp, statSync(target).mode)
    } catch {
      // New file or a filesystem without POSIX modes: keep the default mode.
    }
    renameSync(tmp, target)
  } catch (err) {
    try { unlinkSync(tmp) } catch { /* nothing to clean up */ }
    throw err
  }
}

/** Write every pending file, or none of them. Returns backups of what was written. */
export function commitWrites(
  writes: readonly PendingWrite[],
  writer: FileWriter = writeFileAtomic,
): FileBackup[] {
  const done: FileBackup[] = []
  for (const w of writes) {
    try {
      writer(w.filepath, w.text)
    } catch (err) {
      throw new PatchWriteError(w.filepath, err, restoreBackups(done, writer))
    }
    done.push({ filepath: w.filepath, original: w.original })
  }
  return done
}

/** Put every backed-up file back. Keeps going past failures and reports them. */
export function restoreBackups(
  backups: readonly FileBackup[],
  writer: FileWriter = writeFileAtomic,
): RestoreReport {
  const restored: string[] = []
  const failed: RestoreReport['failed'] = []
  for (const b of [...backups].reverse()) {
    try {
      writer(b.filepath, b.original)
      restored.push(b.filepath)
    } catch (err) {
      failed.push({ filepath: b.filepath, error: err instanceof Error ? err.message : String(err) })
    }
  }
  return { restored, failed }
}

/** Write through symlinks to the real file instead of replacing the link. */
function resolveTarget(filepath: string): string {
  try {
    return realpathSync(filepath)
  } catch {
    return filepath
  }
}
