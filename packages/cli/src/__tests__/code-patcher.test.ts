import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  planPatches,
  applyPatches,
  restoreBackups,
  formatManualEdit,
  PatchWriteError,
  _test,
} from '../code-patcher.js'

const OPENAI_CREDENTIALS = ['apiKey', 'baseURL'] as const

describe('stripCredentialProps', () => {
  const { stripCredentialProps } = _test

  it('removes apiKey + baseURL, keeps others', () => {
    const input = `{ apiKey: process.env.SPANLENS_API_KEY, baseURL: 'https://x/', timeout: 5000 }`
    const out = stripCredentialProps(input, OPENAI_CREDENTIALS)
    expect(out.kind).toBe('ok')
    expect(out.text).not.toContain('apiKey')
    expect(out.text).not.toContain('baseURL')
    expect(out.text).toContain('timeout: 5000')
  })

  it('returns empty text when only apiKey + baseURL present', () => {
    const out = stripCredentialProps(`{ apiKey: 'x', baseURL: 'y' }`, OPENAI_CREDENTIALS)
    expect(out).toEqual({ kind: 'ok', text: '' })
  })

  it('preserves unrelated properties and their formatting', () => {
    const input = `{ organization: 'org_xxx', apiKey: 'k', dangerouslyAllowBrowser: true }`
    const out = stripCredentialProps(input, OPENAI_CREDENTIALS)
    expect(out.text).toContain('organization')
    expect(out.text).toContain('dangerouslyAllowBrowser')
    expect(out.text).not.toContain('apiKey')
  })

  it('removes shorthand and quoted credential keys', () => {
    const out = stripCredentialProps(`{ apiKey, "baseURL": u, ['timeout']: 5 }`, OPENAI_CREDENTIALS)
    expect(out.kind).toBe('ok')
    expect(out.text).toBe(`{ ['timeout']: 5 }`)
  })

  it('flags spread members as unsafe but still strips the static credentials', () => {
    const out = stripCredentialProps(`{ ...opts, apiKey: k, timeout: 1 }`, OPENAI_CREDENTIALS)
    expect(out.kind).toBe('unsafe')
    expect(out.text).toBe(`{ ...opts, timeout: 1 }`)
    expect(out.kind === 'unsafe' ? out.unknown : []).toEqual(['...opts'])
  })

  it('flags computed keys it cannot resolve as unsafe', () => {
    const out = stripCredentialProps(`{ [keyName]: k }`, OPENAI_CREDENTIALS)
    expect(out.kind).toBe('unsafe')
    expect(out.kind === 'unsafe' ? out.unknown : []).toEqual(['[keyName]'])
  })
})

describe('formatManualEdit', () => {
  it('prints an exact before/after diff and names the options to clean up', () => {
    const lines = formatManualEdit('app/lib/client.ts', {
      provider: 'openai',
      line: 7,
      original: 'new OpenAI(providerOptions)',
      suggested: 'createOpenAI(providerOptions)',
      unknownSources: ['providerOptions'],
      mustNotSet: ['apiKey', 'baseURL'],
      cautions: [],
      factoryImport: `import { createOpenAI } from '@spanlens/sdk/openai'`,
      reason: 'The options come from `providerOptions`, which the wizard cannot inspect.',
    })
    const text = lines.join('\n')
    expect(text).toContain('app/lib/client.ts:7')
    expect(text).toContain('- new OpenAI(providerOptions)')
    expect(text).toContain('+ createOpenAI(providerOptions)')
    expect(text).toContain(`+ import { createOpenAI } from '@spanlens/sdk/openai'`)
    expect(text).toContain('`providerOptions` must not set apiKey or baseURL')
    expect(text).not.toContain(String.fromCharCode(0x2014))
  })

  it('prints cautions and no replacement when the call must not be switched', () => {
    const lines = formatManualEdit('lib/azure.ts', {
      provider: 'openai',
      line: 2,
      original: `new OpenAI({ defaultQuery: { 'api-version': '2024-10-21' } })`,
      suggested: null,
      unknownSources: [],
      mustNotSet: ['apiKey', 'baseURL'],
      cautions: ['Spanlens proxies Azure OpenAI at /proxy/azure.'],
      factoryImport: null,
      reason: 'This client looks like Azure OpenAI.',
    })
    const text = lines.join('\n')
    expect(text).toContain(`  new OpenAI({ defaultQuery: { 'api-version': '2024-10-21' } })`)
    expect(text).not.toContain('- new OpenAI')
    expect(text).not.toContain('+ ')
    expect(text).toContain('  Spanlens proxies Azure OpenAI at /proxy/azure.')
  })
})

describe('planPatches / applyPatches end-to-end', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cli-patch-test-'))
  })
  afterEach(() => {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
  })

  function writeFile(rel: string, content: string): string {
    const full = join(dir, rel)
    const parentDir = full.split(/[\\/]/).slice(0, -1).join('/')
    if (parentDir) mkdirSync(parentDir, { recursive: true })
    writeFileSync(full, content, 'utf8')
    return full
  }

  it('detects + rewrites basic Next.js route', async () => {
    const path = writeFile(
      'app/api/chat/route.ts',
      [
        `import { NextResponse } from 'next/server'`,
        `import OpenAI from 'openai'`,
        ``,
        `const openai = new OpenAI({`,
        `  apiKey: process.env.SPANLENS_API_KEY,`,
        `  baseURL: 'https://api.spanlens.io/proxy/openai/v1',`,
        `  timeout: 30_000,`,
        `})`,
        ``,
        `export async function POST() {`,
        `  return NextResponse.json({ ok: true })`,
        `}`,
      ].join('\n'),
    )

    const plans = await planPatches(dir, ['openai'])
    expect(plans.length).toBe(1)
    expect(plans[0]?.filepath).toBe(path)
    expect(plans[0]?.changes.some((c) => c.includes('createOpenAI'))).toBe(true)

    await applyPatches(plans)
    const out = readFileSync(path, 'utf8')
    expect(out).toContain(`import { createOpenAI } from '@spanlens/sdk/openai'`)
    expect(out).not.toContain(`import OpenAI from 'openai'`)
    expect(out).toContain(`createOpenAI({`)
    expect(out).toContain(`timeout: 30_000`)
    expect(out).not.toContain(`apiKey:`)
    expect(out).not.toContain(`baseURL:`)
  })

  it('handles `new OpenAI()` with no args', async () => {
    const path = writeFile(
      'lib/openai.ts',
      [
        `import OpenAI from 'openai'`,
        `export const openai = new OpenAI()`,
      ].join('\n'),
    )

    const plans = await planPatches(dir, ['openai'])
    expect(plans.length).toBe(1)
    await applyPatches(plans)
    const out = readFileSync(path, 'utf8')
    expect(out).toContain(`createOpenAI()`)
  })

  it('dry-run does NOT modify files', async () => {
    const path = writeFile(
      'lib/openai.ts',
      [
        `import OpenAI from 'openai'`,
        `export const openai = new OpenAI({ apiKey: 'k', baseURL: 'u' })`,
      ].join('\n'),
    )
    const original = readFileSync(path, 'utf8')

    const plans = await planPatches(dir, ['openai'])
    await applyPatches(plans, { dryRun: true })
    expect(readFileSync(path, 'utf8')).toBe(original)
  })

  it('skips files without OpenAI client', async () => {
    writeFile('lib/other.ts', `export const x = 1`)
    writeFile('lib/fake.ts', `// openai is mentioned in comment but no import`)
    const plans = await planPatches(dir, ['openai'])
    expect(plans.length).toBe(0)
  })

  it('skips node_modules and .next', async () => {
    writeFile(
      'node_modules/pkg/index.ts',
      `import OpenAI from 'openai'\nconst o = new OpenAI()`,
    )
    writeFile(
      '.next/server/chunks/0.js',
      `import OpenAI from 'openai'\nconst o = new OpenAI()`,
    )
    const plans = await planPatches(dir, ['openai'])
    expect(plans.length).toBe(0)
  })

  it('is idempotent: an already patched file produces no plan', async () => {
    writeFile('lib/openai.ts', `import OpenAI from 'openai'\nexport const o = new OpenAI()\n`)
    await applyPatches(await planPatches(dir, ['openai']))
    expect(await planPatches(dir, ['openai'])).toEqual([])
  })

  it('previews exactly what happens to a shared import', async () => {
    writeFile(
      'lib/openai.ts',
      `import OpenAI, { APIError } from 'openai'\nexport const o = new OpenAI()\nexport { APIError }\n`,
    )
    const [plan] = await planPatches(dir, ['openai'])
    const preview = plan?.changes.join('\n') ?? ''
    expect(preview).toContain('APIError')
    expect(preview).toContain('createOpenAI')
  })

  it('reports a manual edit with the line of the untouched call', async () => {
    const path = writeFile(
      'lib/openai.ts',
      [
        `import OpenAI from 'openai'`,
        ``,
        `const providerOptions = { apiKey: process.env.OPENAI_API_KEY }`,
        `export const o = new OpenAI(providerOptions)`,
      ].join('\n'),
    )
    const plans = await planPatches(dir, ['openai'])
    expect(plans).toHaveLength(1)
    expect(plans[0]?.changes).toEqual([])
    expect(plans[0]?.manual[0]?.line).toBe(4)

    const { results } = await applyPatches(plans)
    expect(results[0]?.patched).toBe(false)
    expect(results[0]?.manual).toHaveLength(1)
    expect(readFileSync(path, 'utf8')).not.toContain('createOpenAI')
  })

  it('reports a CommonJS require() client instead of skipping it silently', async () => {
    const path = writeFile(
      'lib/openai.js',
      [
        `const OpenAI = require('openai')`,
        ``,
        `module.exports = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 1000 })`,
      ].join('\n'),
    )
    const original = readFileSync(path, 'utf8')
    const plans = await planPatches(dir, ['openai'])
    expect(plans).toHaveLength(1)
    expect(plans[0]?.changes).toEqual([])
    const edit = plans[0]?.manual[0]
    expect(edit?.line).toBe(3)
    expect(edit?.reason).toContain(`require('openai')`)
    expect(edit?.suggested).toBe('createOpenAI({ timeout: 1000 })')
    expect(edit?.cautions.join('\n')).toMatch(/ES module/)

    await applyPatches(plans)
    expect(readFileSync(path, 'utf8')).toBe(original)
  })

  it('reports destructured require() and dynamic import() clients', async () => {
    writeFile('lib/a.js', `const { OpenAI } = require('openai')\nexports.a = new OpenAI()\n`)
    writeFile(
      'lib/b.ts',
      `export async function make() {\n  const { default: Anthropic } = await import('@anthropic-ai/sdk')\n  return new Anthropic()\n}\n`,
    )
    const plans = await planPatches(dir, ['openai', 'anthropic'])
    const byProvider = Object.fromEntries(plans.map((p) => [p.provider, p.manual]))
    expect(byProvider['openai']?.[0]?.reason).toContain(`require('openai')`)
    expect(byProvider['anthropic']?.[0]?.reason).toContain(`import('@anthropic-ai/sdk')`)
    expect(byProvider['anthropic']?.[0]?.suggested).toBe('createAnthropic()')
  })

  it('ignores an OpenAI class that comes from another package', async () => {
    writeFile(
      'lib/llm.ts',
      `import { OpenAI } from '@langchain/openai'\nexport const llm = new OpenAI({ model: 'gpt-4o-mini' })\n`,
    )
    expect(await planPatches(dir, ['openai'])).toEqual([])
  })

  it('does not report other classes exported by the provider package', async () => {
    writeFile(
      'lib/azure.ts',
      `import { AzureOpenAI } from 'openai'\nexport const client = new AzureOpenAI({ apiVersion: '2024-10-21' })\n`,
    )
    expect(await planPatches(dir, ['openai'])).toEqual([])
  })

  it('leaves fetchOptions.headers for a manual edit', async () => {
    // The typings forbid it, but in JavaScript fetchOptions.headers replaces
    // every header the client builds, the Spanlens key included.
    const path = writeFile(
      'lib/anthropic.js',
      `import Anthropic from '@anthropic-ai/sdk'
export const c = new Anthropic({ fetchOptions: { headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY } } })
`,
    )
    const original = readFileSync(path, 'utf8')
    const plans = await planPatches(dir, ['anthropic'])
    expect(plans[0]?.changes).toEqual([])
    expect(plans[0]?.manual[0]?.reason).toContain('fetchOptions')
    await applyPatches(plans)
    expect(readFileSync(path, 'utf8')).toBe(original)
  })

  it('previews the credential headers it removes', async () => {
    writeFile(
      'lib/openai.ts',
      `import OpenAI from 'openai'\nexport const o = new OpenAI({ defaultHeaders: { 'Helicone-Auth': 'Bearer x', 'X-Title': 't' } })\n`,
    )
    const [plan] = await planPatches(dir, ['openai'])
    expect(plan?.changes.join('\n')).toContain('defaultHeaders "Helicone-Auth"')
  })

  it('keeps CRLF line endings when it adds an import line', async () => {
    const path = writeFile(
      'lib/openai.ts',
      `import OpenAI from 'openai'\r\nexport type C = OpenAI\r\nexport const o = new OpenAI()\r\n`,
    )
    await applyPatches(await planPatches(dir, ['openai']))
    const out = readFileSync(path, 'utf8')
    expect(out).toContain(`import { createOpenAI } from '@spanlens/sdk/openai'\r\n`)
    expect(out.replace(/\r\n/g, '')).not.toContain('\n')
  })
})

describe('applyPatches backups and rollback', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cli-rollback-test-'))
  })
  afterEach(() => {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
  })

  function write(rel: string, content: string): string {
    const full = join(dir, rel)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, content, 'utf8')
    return full
  }

  it('returns a backup of every written file and restoreBackups puts them back', async () => {
    const a = write('a.ts', `import OpenAI from 'openai'\nexport const a = new OpenAI()\n`)
    const b = write('b.ts', `import Anthropic from '@anthropic-ai/sdk'\nexport const b = new Anthropic()\n`)
    const originalA = readFileSync(a, 'utf8')
    const originalB = readFileSync(b, 'utf8')

    const { backups, results } = await applyPatches(await planPatches(dir, ['openai', 'anthropic']))
    expect(results.every((r) => r.patched)).toBe(true)
    expect(backups.map((x) => x.filepath).sort()).toEqual([a, b].sort())
    expect(readFileSync(a, 'utf8')).not.toBe(originalA)

    const report = restoreBackups(backups)
    expect(report.failed).toEqual([])
    expect(readFileSync(a, 'utf8')).toBe(originalA)
    expect(readFileSync(b, 'utf8')).toBe(originalB)
  })

  it('writes nothing and returns no backups on a dry run', async () => {
    const a = write('a.ts', `import OpenAI from 'openai'\nexport const a = new OpenAI()\n`)
    const original = readFileSync(a, 'utf8')
    const { backups } = await applyPatches(await planPatches(dir, ['openai']), { dryRun: true })
    expect(backups).toEqual([])
    expect(readFileSync(a, 'utf8')).toBe(original)
  })

  it('restores earlier files when a later write fails, then throws', () => {
    const a = write('a.ts', 'original a')
    const b = write('b.ts', 'original b')
    const writes = [
      { filepath: a, original: 'original a', text: 'patched a' },
      { filepath: b, original: 'original b', text: 'patched b' },
    ]
    const failingWriter = (filepath: string, text: string): void => {
      if (filepath === b && text === 'patched b') throw new Error('disk full')
      writeFileSync(filepath, text, 'utf8')
    }
    expect(() => _test.commitWrites(writes, failingWriter)).toThrow(PatchWriteError)
    expect(readFileSync(a, 'utf8')).toBe('original a')
    expect(readFileSync(b, 'utf8')).toBe('original b')
  })

  it('applies the same provider patch to one file only once when two providers share it', async () => {
    const a = write(
      'both.ts',
      [
        `import OpenAI from 'openai'`,
        `import Anthropic from '@anthropic-ai/sdk'`,
        `export const o = new OpenAI()`,
        `export const c = new Anthropic()`,
        ``,
      ].join('\n'),
    )
    const { backups } = await applyPatches(await planPatches(dir, ['openai', 'anthropic']))
    expect(backups).toHaveLength(1)
    const out = readFileSync(a, 'utf8')
    expect(out).toContain(`import { createOpenAI } from '@spanlens/sdk/openai'`)
    expect(out).toContain(`import { createAnthropic } from '@spanlens/sdk/anthropic'`)
    expect(out).toContain('createOpenAI()')
    expect(out).toContain('createAnthropic()')
  })
})

describe('pre-write compile check', () => {
  const { findIntroducedProblems } = _test

  it('flags a patched file that loses a binding it still uses', () => {
    const problems = findIntroducedProblems([
      {
        filepath: '/p/route.ts',
        before: `import OpenAI from 'openai'\nexport type C = OpenAI\nexport const o = new OpenAI()\n`,
        after: `import { createOpenAI } from '@spanlens/sdk/openai'\nexport type C = OpenAI\nexport const o = createOpenAI()\n`,
      },
    ])
    expect(problems.get('/p/route.ts')?.join('\n')).toMatch(/OpenAI/)
  })

  it('ignores problems that were already there before the patch', () => {
    const problems = findIntroducedProblems([
      {
        filepath: '/p/route.js',
        before: `import OpenAI from 'openai'\nexport const o = new OpenAI()\nundefinedThing()\n`,
        after: `import { createOpenAI } from '@spanlens/sdk/openai'\nexport const o = createOpenAI()\nundefinedThing()\n`,
      },
    ])
    expect(problems.size).toBe(0)
  })

  it('keeps a file untouched when the factory name collides with a local declaration', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cli-collision-test-'))
    try {
      const path = join(dir, 'route.ts')
      const original = [
        `import OpenAI from 'openai'`,
        `function createOpenAI() { return 1 }`,
        `export const a = createOpenAI()`,
        `export const o = new OpenAI()`,
        ``,
      ].join('\n')
      writeFileSync(path, original, 'utf8')
      const { results, backups } = await applyPatches(await planPatches(dir, ['openai']))
      expect(results[0]?.patched).toBe(false)
      expect(results[0]?.problems?.join('\n')).toMatch(/createOpenAI/)
      expect(backups).toEqual([])
      expect(readFileSync(path, 'utf8')).toBe(original)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('flags syntax errors introduced by the patch', () => {
    const problems = findIntroducedProblems([
      {
        filepath: '/p/route.tsx',
        before: `export const o = 1\n`,
        after: `export const o = (\n`,
      },
    ])
    expect(problems.has('/p/route.tsx')).toBe(true)
  })
})
