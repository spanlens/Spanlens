import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, symlinkSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

// The wizard's prompts are interactive; answer "yes" and record what it prints.
const printed: string[] = []
vi.mock('@clack/prompts', () => {
  const record = (msg: unknown): void => { printed.push(String(msg)) }
  return {
    confirm: vi.fn(async () => true),
    isCancel: () => false,
    spinner: () => ({ start: record, stop: record }),
    log: { message: record, warn: record, error: record, info: record, success: record, step: record },
  }
})

const { runPatchStep, finalOutcome } = await import('../patch-step.js')

/**
 * End-to-end check of C15.1's verification contract: the project's real
 * `tsc --noEmit` runs before and after the patch, and a patch that
 * introduces errors is rolled back and reported as not finished.
 */

const typescriptDir = dirname(dirname(realpathSync(createRequire(import.meta.url).resolve('typescript/bin/tsc'))))

const OPENAI_STUB = `declare module 'openai' {
  export default class OpenAI {
    constructor(options?: { apiKey?: string; baseURL?: string; timeout?: number })
  }
}
`
const SPANLENS_STUB = `declare module '@spanlens/sdk/openai' {
  import OpenAI from 'openai'
  export function createOpenAI(options?: { timeout?: number }): OpenAI
}
`
const ROUTE = [
  `import OpenAI from 'openai'`,
  `export const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 1000 })`,
  ``,
].join('\n')

describe('runPatchStep verify + rollback', () => {
  let dir: string
  beforeEach(() => {
    printed.length = 0
    dir = mkdtempSync(join(tmpdir(), 'cli-patch-step-test-'))
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fixture', private: true }))
    writeFileSync(
      join(dir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: { strict: true, noEmit: true, module: 'esnext', moduleResolution: 'bundler', types: [] },
        include: ['**/*.ts'],
      }),
    )
    mkdirSync(join(dir, 'node_modules'))
    symlinkSync(typescriptDir, join(dir, 'node_modules', 'typescript'), 'junction')
    mkdirSync(join(dir, 'app'))
    writeFileSync(join(dir, 'app', 'route.ts'), ROUTE)
    writeFileSync(join(dir, 'openai.d.ts'), OPENAI_STUB)
    writeFileSync(join(dir, 'globals.d.ts'), `declare const process: { env: Record<string, string | undefined> }\n`)
  })
  afterEach(() => {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
  })

  it('keeps a patch that type-checks and reports success', async () => {
    writeFileSync(join(dir, 'spanlens.d.ts'), SPANLENS_STUB)
    const status = await runPatchStep({ cwd: dir, providers: ['openai'], dryRun: false, typecheck: true })
    expect(status).toBe('patched')
    expect(readFileSync(join(dir, 'app', 'route.ts'), 'utf8')).toContain('createOpenAI({ timeout: 1000 })')
    expect(printed.join('\n')).toContain('TypeScript check passed')
  }, 120_000)

  it('restores every patched file when the patch introduces a type error', async () => {
    // No @spanlens/sdk typings: the patched import cannot resolve, which is
    // exactly what happens when the SDK install was skipped.
    const status = await runPatchStep({ cwd: dir, providers: ['openai'], dryRun: false, typecheck: true })
    expect(status).toBe('failed')
    expect(readFileSync(join(dir, 'app', 'route.ts'), 'utf8')).toBe(ROUTE)
    const log = printed.join('\n')
    expect(log).toContain('every patched file was restored')
    expect(log).toContain('@spanlens/sdk/openai')
    expect(log).toContain('Install it with your package manager and run the wizard again')

    const outcome = finalOutcome(status)
    expect(outcome.exitCode).toBe(1)
    expect(outcome.message).not.toMatch(/complete/i)
    expect(outcome.showCta).toBe(false)
  }, 120_000)

  it('does not touch a call it cannot rewrite safely and reports it as unfinished', async () => {
    writeFileSync(join(dir, 'spanlens.d.ts'), SPANLENS_STUB)
    const original = [
      `import OpenAI from 'openai'`,
      `const providerOptions = { apiKey: process.env.OPENAI_API_KEY, baseURL: 'https://api.openai.com/v1' }`,
      `export const client = new OpenAI(providerOptions)`,
      ``,
    ].join('\n')
    writeFileSync(join(dir, 'app', 'route.ts'), original)
    const status = await runPatchStep({ cwd: dir, providers: ['openai'], dryRun: false, typecheck: true })
    expect(status).toBe('needs-manual')
    expect(readFileSync(join(dir, 'app', 'route.ts'), 'utf8')).toBe(original)
    expect(printed.join('\n')).toContain('+ createOpenAI(providerOptions)')
    expect(finalOutcome(status).message).not.toMatch(/setup complete/i)
  }, 120_000)
})
