import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

/**
 * Project-level type-check gate. The wizard runs the project's own `tsc
 * --noEmit` once before writing the patch (baseline) and once after, and
 * judges the patch by the errors it introduced. Comparing against a baseline
 * matters: many real projects already have type errors, and those must not
 * make the wizard roll back a correct patch.
 */

export interface TscDiagnostic {
  /** Path as tsc printed it, '' for global (config) errors. */
  file: string
  /** e.g. 'TS2304' */
  code: string
  message: string
  line: number | null
  raw: string
}

export type TscRun =
  | { kind: 'clean' }
  | { kind: 'errors'; diagnostics: TscDiagnostic[] }
  | { kind: 'unavailable'; reason: string }

export type TypecheckVerdict =
  | { kind: 'passed' }
  | { kind: 'failed'; introduced: TscDiagnostic[] }
  | { kind: 'unverified'; reason: string }

export interface ExecResult {
  status: number | null
  stdout: string
  stderr: string
  error?: Error & { code?: string }
}

export type ExecFn = (
  command: string,
  args: readonly string[],
  opts: { cwd: string; timeoutMs: number },
) => ExecResult

export const DEFAULT_TSC_TIMEOUT_MS = 120_000

/** Resolve the project's own TypeScript compiler, or null when it is not installed. */
export function findLocalTsc(cwd: string): string | null {
  try {
    const projectRequire = createRequire(join(cwd, 'package.json'))
    const tsc = projectRequire.resolve('typescript/bin/tsc')
    return existsSync(tsc) ? tsc : null
  } catch {
    return null
  }
}

const defaultExec: ExecFn = (command, args, { cwd, timeoutMs }) => {
  const res = spawnSync(command, [...args], {
    cwd,
    timeout: timeoutMs,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  })
  return {
    status: res.status,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
    ...(res.error ? { error: res.error } : {}),
  }
}

export function runTsc(
  cwd: string,
  tscPath: string,
  opts: { timeoutMs?: number; exec?: ExecFn } = {},
): TscRun {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TSC_TIMEOUT_MS
  const exec = opts.exec ?? defaultExec
  const res = exec(process.execPath, [tscPath, '--noEmit', '--pretty', 'false'], { cwd, timeoutMs })

  if (res.error) {
    const reason =
      res.error.code === 'ETIMEDOUT'
        ? `tsc did not finish within ${Math.round(timeoutMs / 1000)}s`
        : `tsc could not run (${res.error.message})`
    return { kind: 'unavailable', reason }
  }
  if (res.status === 0) return { kind: 'clean' }

  const diagnostics = parseTscOutput(`${res.stdout}\n${res.stderr}`)
  if (diagnostics.length === 0) {
    return { kind: 'unavailable', reason: `tsc exited with status ${res.status ?? 'unknown'} without printing diagnostics` }
  }
  return { kind: 'errors', diagnostics }
}

const FILE_DIAGNOSTIC = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/
const GLOBAL_DIAGNOSTIC = /^error (TS\d+): (.*)$/

/** Parse `tsc --pretty false` output. Indented lines continue the previous message. */
export function parseTscOutput(text: string): TscDiagnostic[] {
  const out: TscDiagnostic[] = []
  for (const line of text.split(/\r?\n/)) {
    const fileMatch = FILE_DIAGNOSTIC.exec(line)
    if (fileMatch) {
      out.push({
        file: fileMatch[1]!,
        code: fileMatch[4]!,
        message: fileMatch[5]!,
        line: Number(fileMatch[2]),
        raw: line,
      })
      continue
    }
    const globalMatch = GLOBAL_DIAGNOSTIC.exec(line)
    if (globalMatch) {
      out.push({ file: '', code: globalMatch[1]!, message: globalMatch[2]!, line: null, raw: line })
      continue
    }
    const last = out[out.length - 1]
    if (last && /^\s+\S/.test(line)) {
      out[out.length - 1] = { ...last, message: `${last.message}\n${line.trim()}`, raw: `${last.raw}\n${line}` }
    }
  }
  return out
}

/**
 * Decide whether the patch broke the build. Errors are matched on
 * file + code + message (not line: the patch shifts lines) as a multiset,
 * so a second copy of an existing error still counts as new.
 */
export function judgeTypecheck(before: TscRun, after: TscRun): TypecheckVerdict {
  if (after.kind === 'unavailable') return { kind: 'unverified', reason: after.reason }
  if (after.kind === 'clean') return { kind: 'passed' }
  // Without a usable baseline the wizard cannot tell who caused the errors,
  // so it assumes the patch did rather than risk shipping a broken build.
  if (before.kind !== 'errors') return { kind: 'failed', introduced: after.diagnostics }

  const remaining = new Map<string, number>()
  for (const d of before.diagnostics) remaining.set(keyOf(d), (remaining.get(keyOf(d)) ?? 0) + 1)
  const introduced: TscDiagnostic[] = []
  for (const d of after.diagnostics) {
    const left = remaining.get(keyOf(d)) ?? 0
    if (left > 0) remaining.set(keyOf(d), left - 1)
    else introduced.push(d)
  }
  return introduced.length === 0 ? { kind: 'passed' } : { kind: 'failed', introduced }
}

function keyOf(d: TscDiagnostic): string {
  return `${d.file}\u0000${d.code}\u0000${d.message}`
}
