import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

/**
 * Type-check patched fixture files against the REAL provider SDK typings
 * (openai, @anthropic-ai/sdk, @google/generative-ai) and the real
 * @spanlens/sdk factory sources. A mock would hide exactly the class of bug
 * these tests guard against: a rewrite that leaves `OpenAI` referenced after
 * its import is gone only fails when a real compiler resolves the names.
 *
 * The provider packages are dev dependencies of packages/sdk, so we resolve
 * them from there instead of adding them to the CLI.
 */

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../../../../..')
const sdkDir = join(repoRoot, 'packages/sdk')
const sdkRequire = createRequire(join(sdkDir, 'package.json'))

function packageDir(name: string, entryRelativeToDir: string): string {
  const entry = realpathSync(sdkRequire.resolve(name))
  return resolve(dirname(entry), entryRelativeToDir)
}

const openaiDir = packageDir('openai', '.')
const anthropicDir = packageDir('@anthropic-ai/sdk', '.')
const googleTypes = join(packageDir('@google/generative-ai', '.'), 'generative-ai.d.ts')
const cliTypeRoots = resolve(here, '../../../node_modules/@types')

const COMPILER_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  noEmit: true,
  skipLibCheck: true,
  esModuleInterop: true,
  allowJs: true,
  checkJs: true,
  jsx: ts.JsxEmit.Preserve,
  types: ['node'],
  typeRoots: [cliTypeRoots],
  paths: {
    openai: [join(openaiDir, 'index.d.ts')],
    'openai/*': [join(openaiDir, '*')],
    '@anthropic-ai/sdk': [join(anthropicDir, 'index.d.ts')],
    '@anthropic-ai/sdk/*': [join(anthropicDir, '*')],
    '@google/generative-ai': [googleTypes],
    '@spanlens/sdk/openai': [join(sdkDir, 'src/integrations/openai.ts')],
    '@spanlens/sdk/anthropic': [join(sdkDir, 'src/integrations/anthropic.ts')],
    '@spanlens/sdk/gemini': [join(sdkDir, 'src/integrations/gemini.ts')],
  },
}

export interface FixtureDiagnostic {
  file: string
  code: number
  message: string
}

/** Compile `files` and return every diagnostic that lands in one of them. */
export function compileFixtures(files: readonly string[]): FixtureDiagnostic[] {
  const program = ts.createProgram({ rootNames: [...files], options: COMPILER_OPTIONS })
  const wanted = new Set(files.map((f) => normalize(f)))
  return ts
    .getPreEmitDiagnostics(program)
    .filter((d) => d.file !== undefined && wanted.has(normalize(d.file.fileName)))
    .map((d) => ({
      file: d.file?.fileName ?? '',
      code: d.code,
      message: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
    }))
}

function normalize(p: string): string {
  return resolve(p).replace(/\\/g, '/').toLowerCase()
}
