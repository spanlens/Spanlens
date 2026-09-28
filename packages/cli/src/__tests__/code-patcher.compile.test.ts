import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { planPatches, applyPatches, type PatchPlan } from '../code-patcher.js'
import { compileFixtures, type FixtureDiagnostic } from './helpers/compile-fixtures.js'

/**
 * Regression suite for C15.1 / C15.3: every fixture is patched through the
 * real planPatches/applyPatches pipeline and the result is compiled with tsc
 * against the real provider SDK typings.
 */

const FIXTURES: Record<string, string> = {
  // Default import plus named imports, a type alias, a namespace type, and
  // both instanceof forms. The wizard used to replace the whole declaration.
  'mixed-import.ts': [
    `import OpenAI, { APIError, toFile } from 'openai'`,
    ``,
    `type Client = OpenAI`,
    `export type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam`,
    ``,
    `export const client: Client = new OpenAI({`,
    `  apiKey: process.env.OPENAI_API_KEY,`,
    `  timeout: 30_000,`,
    `})`,
    ``,
    `export function isApiError(e: unknown): boolean {`,
    `  return e instanceof APIError || e instanceof OpenAI.APIError`,
    `}`,
    ``,
    `export async function upload(data: Uint8Array) {`,
    `  return toFile(data, 'data.bin')`,
    `}`,
    ``,
  ].join('\n'),

  // The default binding is no longer needed, but the named import is.
  'named-kept.ts': [
    `import OpenAI, { APIError } from 'openai'`,
    `export const client = new OpenAI()`,
    `export const isApiError = (e: unknown) => e instanceof APIError`,
    ``,
  ].join('\n'),

  // Only a type annotation keeps OpenAI alive.
  'type-ref.ts': [
    `import OpenAI from 'openai'`,
    `export function make(): OpenAI {`,
    `  return new OpenAI({ apiKey: 'sk-test', baseURL: 'https://api.openai.com/v1', maxRetries: 1 })`,
    `}`,
    ``,
  ].join('\n'),

  // Shorthand props: the example in the patcher's own docstring.
  'shorthand.ts': [
    `import OpenAI from 'openai'`,
    `const apiKey = process.env.OPENAI_API_KEY`,
    `const baseURL = 'https://api.openai.com/v1'`,
    `export const client = new OpenAI({ apiKey, baseURL, timeout: 1000 })`,
    ``,
  ].join('\n'),

  // Spread options cannot be analysed: must be left for a manual edit.
  'spread.ts': [
    `import OpenAI from 'openai'`,
    `const opts = { apiKey: process.env.OPENAI_API_KEY, baseURL: 'https://api.openai.com/v1' }`,
    `export const client = new OpenAI({ ...opts, timeout: 1000 })`,
    ``,
  ].join('\n'),

  // Options held in a variable cannot be analysed either.
  'variable-options.ts': [
    `import OpenAI from 'openai'`,
    `const providerOptions = { apiKey: process.env.OPENAI_API_KEY, baseURL: 'https://api.openai.com/v1' }`,
    `export const client = new OpenAI(providerOptions)`,
    ``,
  ].join('\n'),

  // One call can be rewritten, the other cannot. The import must survive.
  'mixed-calls.ts': [
    `import OpenAI from 'openai'`,
    `const providerOptions = { apiKey: process.env.OPENAI_API_KEY }`,
    `export const direct = new OpenAI(providerOptions)`,
    `export const routed = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })`,
    ``,
  ].join('\n'),

  'anthropic-mixed.ts': [
    `import Anthropic, { APIError } from '@anthropic-ai/sdk'`,
    ``,
    `export type Param = Anthropic.Messages.MessageParam`,
    `export const anthropic = new Anthropic({`,
    `  apiKey: process.env.ANTHROPIC_API_KEY,`,
    `  authToken: process.env.ANTHROPIC_AUTH_TOKEN,`,
    `  maxRetries: 2,`,
    `})`,
    `export function isClient(x: unknown): x is Anthropic {`,
    `  return x instanceof Anthropic`,
    `}`,
    `export const isApiError = (e: unknown) => e instanceof APIError`,
    ``,
  ].join('\n'),

  'anthropic-shorthand.ts': [
    `import Anthropic from '@anthropic-ai/sdk'`,
    `const apiKey = process.env.ANTHROPIC_API_KEY`,
    `const baseURL = 'https://api.anthropic.com'`,
    `export const anthropic = new Anthropic({ apiKey, baseURL })`,
    ``,
  ].join('\n'),

  'anthropic-variable.ts': [
    `import Anthropic from '@anthropic-ai/sdk'`,
    `const opts = { apiKey: process.env.ANTHROPIC_API_KEY }`,
    `export const anthropic = new Anthropic(opts)`,
    ``,
  ].join('\n'),

  'gemini-named.ts': [
    `import { GoogleGenerativeAI, HarmCategory } from '@google/generative-ai'`,
    `export const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? '')`,
    `export const category = HarmCategory.HARM_CATEGORY_HARASSMENT`,
    ``,
  ].join('\n'),

  'semicolons.ts': [
    `import OpenAI from "openai";`,
    `export const client = new OpenAI();`,
    ``,
  ].join('\n'),

  // openai merges defaultHeaders after its own auth header, so a leftover
  // Authorization would override the Spanlens key and send the OpenAI key.
  'headers-authorization.ts': [
    `import OpenAI from 'openai'`,
    `export const client = new OpenAI({`,
    `  defaultHeaders: { Authorization: \`Bearer \${process.env.OPENAI_API_KEY}\`, 'X-Title': 'my-app' },`,
    `})`,
    ``,
  ].join('\n'),

  // The Helicone migration pattern: every Helicone-* header is a gateway
  // header, and Helicone-Auth is a credential for another service.
  'helicone.ts': [
    `import OpenAI from 'openai'`,
    `export const client = new OpenAI({`,
    `  apiKey: process.env.OPENAI_API_KEY,`,
    `  baseURL: 'https://oai.helicone.ai/v1',`,
    `  defaultHeaders: {`,
    `    'Helicone-Auth': \`Bearer \${process.env.HELICONE_API_KEY}\`,`,
    `    'Helicone-User-Id': 'user-1',`,
    `  },`,
    `})`,
    ``,
  ].join('\n'),

  // Azure OpenAI through the plain client. createOpenAI() would talk to
  // OpenAI instead, so the wizard must not switch it.
  'azure.ts': [
    `import OpenAI from 'openai'`,
    `export const client = new OpenAI({`,
    `  baseURL: \`https://my-resource.openai.azure.com/openai/deployments/gpt-4o\`,`,
    `  defaultQuery: { 'api-version': '2024-10-21' },`,
    `  defaultHeaders: { 'api-key': process.env.AZURE_OPENAI_API_KEY },`,
    `})`,
    ``,
  ].join('\n'),

  // Headers held in a variable cannot be inspected (Portkey's createHeaders()
  // helper produces exactly this shape).
  'headers-variable.ts': [
    `import OpenAI from 'openai'`,
    `const headers = { 'x-portkey-api-key': process.env.PORTKEY_API_KEY ?? '' }`,
    `export const client = new OpenAI({ defaultHeaders: headers, timeout: 1000 })`,
    ``,
  ].join('\n'),

  // A custom fetch can add any header or change the host.
  'custom-fetch.ts': [
    `import OpenAI from 'openai'`,
    `export const client = new OpenAI({`,
    `  fetch: (url, init) => fetch(url, init),`,
    `})`,
    ``,
  ].join('\n'),

  // fetchOptions without headers carries no credential and stays.
  'fetch-options.ts': [
    `import Anthropic from '@anthropic-ai/sdk'`,
    `export const anthropic = new Anthropic({`,
    `  apiKey: process.env.ANTHROPIC_API_KEY,`,
    `  fetchOptions: { keepalive: true },`,
    `})`,
    ``,
  ].join('\n'),

  // A neutral header name with a credential-looking value.
  'header-credential-value.ts': [
    `import OpenAI from 'openai'`,
    `export const client = new OpenAI({ defaultHeaders: { 'X-Upstream': process.env.OPENAI_API_KEY } })`,
    ``,
  ].join('\n'),

  // Credential query parameters are dropped, the rest stays.
  'default-query.ts': [
    `import OpenAI from 'openai'`,
    `export const client = new OpenAI({ defaultQuery: { api_key: process.env.OPENAI_API_KEY, tag: 'web' } })`,
    ``,
  ].join('\n'),

  // Anthropic with a gateway credential header.
  'anthropic-headers.ts': [
    `import Anthropic from '@anthropic-ai/sdk'`,
    `export const anthropic = new Anthropic({`,
    `  defaultHeaders: { 'x-portkey-api-key': process.env.PORTKEY_API_KEY, 'anthropic-beta': 'tools-2024-04-04' },`,
    `})`,
    ``,
  ].join('\n'),

  // Named imports of the client class are as valid as the default import.
  'named-openai.ts': [
    `import { OpenAI, APIError } from 'openai'`,
    `export const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })`,
    `export const isApiError = (e: unknown) => e instanceof APIError`,
    ``,
  ].join('\n'),

  'named-anthropic-alias.ts': [
    `import { Anthropic as Claude } from '@anthropic-ai/sdk'`,
    `export type Client = Claude`,
    `export const anthropic = new Claude({ apiKey: process.env.ANTHROPIC_API_KEY })`,
    ``,
  ].join('\n'),

  'named-anthropic-only.ts': [
    `import { Anthropic } from '@anthropic-ai/sdk'`,
    `export const anthropic = new Anthropic()`,
    ``,
  ].join('\n'),

  // A namespace import is not rewritten automatically, but must be reported.
  'namespace-openai.ts': [
    `import * as oai from 'openai'`,
    `export const client = new oai.OpenAI({ apiKey: process.env.OPENAI_API_KEY })`,
    ``,
  ].join('\n'),
}

/** Every manual edit the plans report for one fixture. */
function manualFor(plans: readonly PatchPlan[], filepath: string) {
  return plans.filter((p) => p.filepath === filepath).flatMap((p) => p.manual)
}

describe('patched output compiles against the real provider SDKs', () => {
  let dir: string
  let plans: PatchPlan[]
  let before: FixtureDiagnostic[]
  let after: FixtureDiagnostic[]
  const out: Record<string, string> = {}

  const pathOf = (name: string): string => join(dir, 'app', name)

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'cli-compile-test-'))
    mkdirSync(join(dir, 'app'), { recursive: true })
    for (const [name, content] of Object.entries(FIXTURES)) {
      writeFileSync(pathOf(name), content, 'utf8')
    }
    const files = Object.keys(FIXTURES).map(pathOf)

    before = compileFixtures(files)
    plans = await planPatches(dir, ['openai', 'anthropic', 'gemini'])
    await applyPatches(plans)
    for (const name of Object.keys(FIXTURES)) out[name] = readFileSync(pathOf(name), 'utf8')
    after = compileFixtures(files)
  }, 120_000)

  afterAll(() => {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
  })

  it('fixtures compile before the patch (sanity check)', () => {
    expect(before).toEqual([])
  })

  it('patched fixtures still compile', () => {
    expect(after).toEqual([])
  })

  it('keeps the provider import when OpenAI is still used as a type, namespace, or instanceof target', () => {
    const src = out['mixed-import.ts']!
    expect(src).toContain(`import OpenAI, { APIError, toFile } from 'openai'`)
    expect(src).toContain(`import { createOpenAI } from '@spanlens/sdk/openai'`)
    expect(src).toContain(`createOpenAI({`)
    expect(src).toContain(`timeout: 30_000`)
    expect(src).not.toContain(`new OpenAI(`)
    expect(src).not.toContain(`apiKey:`)
  })

  it('drops only the default binding when named imports are still needed', () => {
    const src = out['named-kept.ts']!
    expect(src).toContain(`import { APIError } from 'openai'`)
    expect(src).toContain(`import { createOpenAI } from '@spanlens/sdk/openai'`)
    expect(src).not.toMatch(/import OpenAI/)
    expect(src).toContain(`createOpenAI()`)
  })

  it('keeps the default import for a type-only reference', () => {
    const src = out['type-ref.ts']!
    expect(src).toContain(`import OpenAI from 'openai'`)
    expect(src).toContain(`createOpenAI({ maxRetries: 1 })`)
  })

  it('strips shorthand apiKey and baseURL', () => {
    const src = out['shorthand.ts']!
    expect(src).toContain(`createOpenAI({ timeout: 1000 })`)
    expect(src).not.toContain(`{ apiKey, baseURL`)
    expect(src).toContain(`import { createOpenAI } from '@spanlens/sdk/openai'`)
  })

  it('never rewrites spread options and reports a manual edit instead', () => {
    expect(out['spread.ts']).toBe(FIXTURES['spread.ts'])
    const manual = plans.find((p) => p.filepath === pathOf('spread.ts'))?.manual ?? []
    expect(manual).toHaveLength(1)
    expect(manual[0]?.original).toBe(`new OpenAI({ ...opts, timeout: 1000 })`)
  })

  it('never rewrites variable options and reports a manual edit instead', () => {
    expect(out['variable-options.ts']).toBe(FIXTURES['variable-options.ts'])
    expect(out['variable-options.ts']).not.toContain('createOpenAI(providerOptions)')
    const manual = plans.find((p) => p.filepath === pathOf('variable-options.ts'))?.manual ?? []
    expect(manual).toHaveLength(1)
    expect(manual[0]?.suggested).toBe('createOpenAI(providerOptions)')
  })

  it('rewrites the safe call, leaves the unsafe one, and keeps the import alive', () => {
    const src = out['mixed-calls.ts']!
    expect(src).toContain(`import OpenAI from 'openai'`)
    expect(src).toContain(`import { createOpenAI } from '@spanlens/sdk/openai'`)
    expect(src).toContain(`new OpenAI(providerOptions)`)
    expect(src).toContain(`export const routed = createOpenAI()`)
    const manual = plans.find((p) => p.filepath === pathOf('mixed-calls.ts'))?.manual ?? []
    expect(manual).toHaveLength(1)
  })

  it('handles Anthropic the same way and strips authToken', () => {
    const src = out['anthropic-mixed.ts']!
    expect(src).toContain(`import Anthropic, { APIError } from '@anthropic-ai/sdk'`)
    expect(src).toContain(`import { createAnthropic } from '@spanlens/sdk/anthropic'`)
    expect(src).toContain(`createAnthropic({`)
    expect(src).toContain(`maxRetries: 2`)
    expect(src).not.toContain(`apiKey:`)
    expect(src).not.toContain(`authToken:`)
  })

  it('replaces the Anthropic import when nothing else uses it', () => {
    const src = out['anthropic-shorthand.ts']!
    expect(src).toContain(`import { createAnthropic } from '@spanlens/sdk/anthropic'`)
    expect(src).not.toContain(`@anthropic-ai/sdk`)
    expect(src).toContain(`export const anthropic = createAnthropic()`)
  })

  it('leaves Anthropic variable options for a manual edit', () => {
    expect(out['anthropic-variable.ts']).toBe(FIXTURES['anthropic-variable.ts'])
    const manual = plans.find((p) => p.filepath === pathOf('anthropic-variable.ts'))?.manual ?? []
    expect(manual).toHaveLength(1)
  })

  it('removes only the GoogleGenerativeAI specifier from a shared import', () => {
    const src = out['gemini-named.ts']!
    expect(src).toContain(`import { HarmCategory } from '@google/generative-ai'`)
    expect(src).toContain(`import { createGemini } from '@spanlens/sdk/gemini'`)
    expect(src).toContain(`export const genAI = createGemini()`)
  })

  it('mirrors the quote and semicolon style of the original import', () => {
    const src = out['semicolons.ts']!
    expect(src).toContain(`import { createOpenAI } from "@spanlens/sdk/openai";`)
    expect(src).toContain(`export const client = createOpenAI();`)
  })

  describe('credentials below the top level of the options (C15.3)', () => {
    it('drops an Authorization header and keeps the other headers', () => {
      const src = out['headers-authorization.ts']!
      expect(src).toContain('createOpenAI({')
      expect(src).not.toContain('Authorization')
      expect(src).not.toContain('OPENAI_API_KEY')
      expect(src).toContain(`'X-Title': 'my-app'`)
    })

    it('drops Helicone headers and removes an emptied defaultHeaders', () => {
      const src = out['helicone.ts']!
      expect(src).toContain('export const client = createOpenAI()')
      expect(src).not.toMatch(/helicone/i)
      expect(src).not.toContain('defaultHeaders')
      const plan = plans.find((p) => p.filepath === pathOf('helicone.ts'))
      expect(plan?.changes.join('\n')).toContain('Helicone-Auth')
    })

    it('leaves an Azure OpenAI client alone and suggests no createOpenAI call', () => {
      expect(out['azure.ts']).toBe(FIXTURES['azure.ts'])
      const [edit, ...rest] = manualFor(plans, pathOf('azure.ts'))
      expect(rest).toEqual([])
      expect(edit?.reason).toMatch(/Azure OpenAI/)
      expect(edit?.suggested).toBeNull()
      expect(edit?.factoryImport).toBeNull()
      expect(edit?.cautions.join('\n')).toContain('/proxy/azure')
    })

    it('leaves headers it cannot read for a manual edit', () => {
      expect(out['headers-variable.ts']).toBe(FIXTURES['headers-variable.ts'])
      const [edit] = manualFor(plans, pathOf('headers-variable.ts'))
      expect(edit?.reason).toContain('`headers`')
      expect(edit?.suggested).toBe('createOpenAI({ defaultHeaders: headers, timeout: 1000 })')
      expect(edit?.cautions.join('\n')).toMatch(/Authorization/)
    })

    it('leaves a custom fetch for a manual edit', () => {
      expect(out['custom-fetch.ts']).toBe(FIXTURES['custom-fetch.ts'])
      const [edit] = manualFor(plans, pathOf('custom-fetch.ts'))
      expect(edit?.reason).toMatch(/custom `fetch`/)
    })

    it('keeps fetchOptions that set no headers', () => {
      const src = out['fetch-options.ts']!
      expect(src).toContain('createAnthropic({')
      expect(src).toContain('fetchOptions: { keepalive: true }')
      expect(src).not.toContain('apiKey')
    })

    it('leaves a header whose value looks like a credential for a manual edit', () => {
      expect(out['header-credential-value.ts']).toBe(FIXTURES['header-credential-value.ts'])
      const [edit] = manualFor(plans, pathOf('header-credential-value.ts'))
      expect(edit?.reason).toContain('X-Upstream')
    })

    it('drops credential query parameters and keeps the rest', () => {
      const src = out['default-query.ts']!
      expect(src).toContain(`createOpenAI({ defaultQuery: { tag: 'web' } })`)
      expect(src).not.toContain('api_key')
    })

    it('scrubs Anthropic headers the same way', () => {
      const src = out['anthropic-headers.ts']!
      expect(src).toContain('createAnthropic({')
      expect(src).not.toContain('portkey')
      expect(src).toContain(`'anthropic-beta': 'tools-2024-04-04'`)
    })
  })

  describe('named and unsupported imports', () => {
    it('rewrites a named OpenAI import and keeps the other bindings', () => {
      const src = out['named-openai.ts']!
      expect(src).toContain(`import { APIError } from 'openai'`)
      expect(src).toContain(`import { createOpenAI } from '@spanlens/sdk/openai'`)
      expect(src).toContain('export const client = createOpenAI()')
    })

    it('rewrites an aliased named Anthropic import and keeps it for the type reference', () => {
      const src = out['named-anthropic-alias.ts']!
      expect(src).toContain(`import { Anthropic as Claude } from '@anthropic-ai/sdk'`)
      expect(src).toContain(`import { createAnthropic } from '@spanlens/sdk/anthropic'`)
      expect(src).toContain('export const anthropic = createAnthropic()')
    })

    it('replaces a named Anthropic import that nothing else uses', () => {
      const src = out['named-anthropic-only.ts']!
      expect(src).toContain(`import { createAnthropic } from '@spanlens/sdk/anthropic'`)
      expect(src).not.toContain('@anthropic-ai/sdk')
      expect(src).toContain('export const anthropic = createAnthropic()')
    })

    it('reports a namespace import instead of skipping it silently', () => {
      expect(out['namespace-openai.ts']).toBe(FIXTURES['namespace-openai.ts'])
      const [edit] = manualFor(plans, pathOf('namespace-openai.ts'))
      expect(edit?.original).toBe('new oai.OpenAI({ apiKey: process.env.OPENAI_API_KEY })')
      expect(edit?.suggested).toBe('createOpenAI()')
      expect(edit?.factoryImport).toBe(`import { createOpenAI } from '@spanlens/sdk/openai'`)
    })
  })
})
