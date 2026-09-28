import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  parseTscOutput,
  judgeTypecheck,
  runTsc,
  findLocalTsc,
  type ExecFn,
  type TscRun,
} from '../verify.js'

const SAMPLE = [
  `app/api/chat/route.ts(2,15): error TS2304: Cannot find name 'OpenAI'.`,
  `lib/x.ts(4,66): error TS2322: Type 'string' is not assignable to type 'number'.`,
  `  The expected type comes from property 'n'.`,
  `error TS5083: Cannot read file '/x/tsconfig.base.json'.`,
  ``,
].join('\n')

describe('parseTscOutput', () => {
  it('parses file diagnostics, continuation lines, and global errors', () => {
    const diags = parseTscOutput(SAMPLE)
    expect(diags).toHaveLength(3)
    expect(diags[0]).toMatchObject({ file: 'app/api/chat/route.ts', code: 'TS2304', line: 2 })
    expect(diags[1]?.message).toContain('The expected type comes from')
    expect(diags[2]).toMatchObject({ file: '', code: 'TS5083' })
  })
})

describe('judgeTypecheck', () => {
  const clean: TscRun = { kind: 'clean' }
  const err = (lines: string): TscRun => ({ kind: 'errors', diagnostics: parseTscOutput(lines) })

  it('passes when the patched project is clean', () => {
    expect(judgeTypecheck(clean, clean)).toEqual({ kind: 'passed' })
  })

  it('fails with every error when the baseline was clean', () => {
    const verdict = judgeTypecheck(clean, err(SAMPLE))
    expect(verdict.kind).toBe('failed')
    expect(verdict.kind === 'failed' ? verdict.introduced : []).toHaveLength(3)
  })

  it('ignores errors that already existed, even if their line moved', () => {
    const before = err(`lib/x.ts(4,1): error TS2322: Type 'string' is not assignable to type 'number'.`)
    const after = err(`lib/x.ts(5,1): error TS2322: Type 'string' is not assignable to type 'number'.`)
    expect(judgeTypecheck(before, after)).toEqual({ kind: 'passed' })
  })

  it('fails on errors the patch introduced next to pre-existing ones', () => {
    const before = err(`lib/x.ts(4,1): error TS2322: Type 'string' is not assignable to type 'number'.`)
    const after = err(
      [
        `lib/x.ts(5,1): error TS2322: Type 'string' is not assignable to type 'number'.`,
        `app/route.ts(2,1): error TS2304: Cannot find name 'OpenAI'.`,
      ].join('\n'),
    )
    const verdict = judgeTypecheck(before, after)
    expect(verdict.kind).toBe('failed')
    expect(verdict.kind === 'failed' ? verdict.introduced.map((d) => d.code) : []).toEqual(['TS2304'])
  })

  it('counts duplicates: a second copy of an existing error is new', () => {
    const line = `app/a.ts(1,1): error TS2304: Cannot find name 'x'.`
    const verdict = judgeTypecheck(err(line), err(`${line}\n${line}`))
    expect(verdict.kind).toBe('failed')
  })

  it('treats errors as failures when the baseline could not run', () => {
    const verdict = judgeTypecheck({ kind: 'unavailable', reason: 'timed out' }, err(SAMPLE))
    expect(verdict.kind).toBe('failed')
  })

  it('is unverified when the patched check could not run', () => {
    expect(judgeTypecheck(clean, { kind: 'unavailable', reason: 'timed out' })).toEqual({
      kind: 'unverified',
      reason: 'timed out',
    })
  })
})

describe('runTsc with an injected exec', () => {
  it('maps exit 0 to clean and passes --noEmit --pretty false', () => {
    let seenArgs: readonly string[] = []
    const exec: ExecFn = (_cmd, args) => {
      seenArgs = args
      return { status: 0, stdout: '', stderr: '' }
    }
    expect(runTsc('/p', '/p/node_modules/typescript/bin/tsc', { exec })).toEqual({ kind: 'clean' })
    expect(seenArgs).toEqual(['/p/node_modules/typescript/bin/tsc', '--noEmit', '--pretty', 'false'])
  })

  it('maps a non-zero exit with diagnostics to errors', () => {
    const exec: ExecFn = () => ({ status: 2, stdout: SAMPLE, stderr: '' })
    const run = runTsc('/p', 'tsc', { exec })
    expect(run.kind).toBe('errors')
  })

  it('maps a timeout to unavailable', () => {
    const exec: ExecFn = () => ({ status: null, stdout: '', stderr: '', error: Object.assign(new Error('spawnSync ETIMEDOUT'), { code: 'ETIMEDOUT' }) })
    const run = runTsc('/p', 'tsc', { exec, timeoutMs: 5 })
    expect(run.kind).toBe('unavailable')
  })

  it('maps a non-zero exit without diagnostics to unavailable', () => {
    const exec: ExecFn = () => ({ status: 1, stdout: 'Segmentation fault', stderr: '' })
    expect(runTsc('/p', 'tsc', { exec }).kind).toBe('unavailable')
  })
})

describe('findLocalTsc + runTsc against a real project', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cli-verify-test-'))
  })
  afterEach(() => {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
  })

  it('returns null when the project has no local typescript', () => {
    writeFileSync(join(dir, 'package.json'), '{}')
    expect(findLocalTsc(dir)).toBeNull()
  })

  it('finds a local typescript install', () => {
    writeFileSync(join(dir, 'package.json'), '{}')
    mkdirSync(join(dir, 'node_modules/typescript/bin'), { recursive: true })
    writeFileSync(join(dir, 'node_modules/typescript/package.json'), '{"name":"typescript","version":"0.0.0"}')
    writeFileSync(join(dir, 'node_modules/typescript/bin/tsc'), '')
    expect(findLocalTsc(dir)).toBe(join(dir, 'node_modules', 'typescript', 'bin', 'tsc'))
  })

  it('reports clean, then the error a broken edit introduces', () => {
    const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc')
    writeFileSync(
      join(dir, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { strict: true, noEmit: true, types: [] }, include: ['*.ts'] }),
    )
    writeFileSync(join(dir, 'a.ts'), `export const n: number = 1\n`)
    const before = runTsc(dir, tsc)
    expect(before).toEqual({ kind: 'clean' })

    writeFileSync(join(dir, 'a.ts'), `export const n: number = missing\n`)
    const after = runTsc(dir, tsc)
    const verdict = judgeTypecheck(before, after)
    expect(verdict.kind).toBe('failed')
    expect(verdict.kind === 'failed' ? verdict.introduced[0]?.code : '').toBe('TS2304')
  }, 60_000)
})
