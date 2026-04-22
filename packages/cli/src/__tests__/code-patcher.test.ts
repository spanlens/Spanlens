import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { planPatches, applyPatches, _test } from '../code-patcher.js'

describe('stripApiKeyAndBaseUrlProps', () => {
  const { stripApiKeyAndBaseUrlProps } = _test

  it('removes apiKey + baseURL, keeps others', () => {
    const input = `{ apiKey: process.env.SPANLENS_API_KEY, baseURL: 'https://x/', timeout: 5000 }`
    const out = stripApiKeyAndBaseUrlProps(input)
    expect(out).not.toContain('apiKey')
    expect(out).not.toContain('baseURL')
    expect(out).toContain('timeout: 5000')
  })

  it('returns empty string when only apiKey + baseURL present', () => {
    const input = `{ apiKey: 'x', baseURL: 'y' }`
    const out = stripApiKeyAndBaseUrlProps(input)
    expect(out).toBe('')
  })

  it('preserves unrelated properties and their formatting', () => {
    const input = `{ organization: 'org_xxx', apiKey: 'k', dangerouslyAllowBrowser: true }`
    const out = stripApiKeyAndBaseUrlProps(input)
    expect(out).toContain('organization')
    expect(out).toContain('dangerouslyAllowBrowser')
    expect(out).not.toContain('apiKey')
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
        `  baseURL: 'https://spanlens-server.vercel.app/proxy/openai/v1',`,
        `  timeout: 30_000,`,
        `})`,
        ``,
        `export async function POST() {`,
        `  return NextResponse.json({ ok: true })`,
        `}`,
      ].join('\n'),
    )

    const plans = await planPatches(dir)
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

    const plans = await planPatches(dir)
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

    const plans = await planPatches(dir)
    await applyPatches(plans, { dryRun: true })
    expect(readFileSync(path, 'utf8')).toBe(original)
  })

  it('skips files without OpenAI client', async () => {
    writeFile('lib/other.ts', `export const x = 1`)
    writeFile('lib/fake.ts', `// openai is mentioned in comment but no import`)
    const plans = await planPatches(dir)
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
    const plans = await planPatches(dir)
    expect(plans.length).toBe(0)
  })
})
