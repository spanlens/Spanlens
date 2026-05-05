import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Project, SyntaxKind, type SourceFile, type Node } from 'ts-morph'

/**
 * AST-based patcher that rewrites direct AI SDK usage into Spanlens-routed
 * helpers. Supports OpenAI, Anthropic, and Gemini.
 *
 *   import OpenAI from 'openai'
 *   const openai = new OpenAI({ apiKey, baseURL })
 *     →
 *   import { createOpenAI } from '@spanlens/sdk/openai'
 *   const openai = createOpenAI()                    // apiKey + baseURL stripped
 *
 *   import Anthropic from '@anthropic-ai/sdk'
 *   const anthropic = new Anthropic({ apiKey, baseURL })
 *     →
 *   import { createAnthropic } from '@spanlens/sdk/anthropic'
 *   const anthropic = createAnthropic()
 *
 *   import { GoogleGenerativeAI } from '@google/generative-ai'
 *   const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
 *     →
 *   import { createGemini } from '@spanlens/sdk/gemini'
 *   const genAI = createGemini()                     // positional apiKey dropped
 *
 * Scope: MVP handles the common Next.js patterns (default/named import at
 * module top + `new XxxClient(...)` call). Aliased imports / re-exports /
 * dynamic imports aren't rewritten in this version.
 */

export type Provider = 'openai' | 'anthropic' | 'gemini'

interface ProviderConfig {
  /** Module specifier the user is importing from. */
  importedFrom: string
  /** Original imported name (default or named). */
  originalName: string
  /** 'default' = default import, 'named' = named import. */
  importStyle: 'default' | 'named'
  /** Replacement: factory function name. */
  factoryName: string
  /** Replacement module specifier. */
  spanlensSdk: string
  /** Constructor arg shape: 'options' (object) or 'string' (positional apiKey). */
  argShape: 'options' | 'string'
}

const PROVIDER_CONFIGS: Record<Provider, ProviderConfig> = {
  openai: {
    importedFrom: 'openai',
    originalName: 'OpenAI',
    importStyle: 'default',
    factoryName: 'createOpenAI',
    spanlensSdk: '@spanlens/sdk/openai',
    argShape: 'options',
  },
  anthropic: {
    importedFrom: '@anthropic-ai/sdk',
    originalName: 'Anthropic',
    importStyle: 'default',
    factoryName: 'createAnthropic',
    spanlensSdk: '@spanlens/sdk/anthropic',
    argShape: 'options',
  },
  gemini: {
    importedFrom: '@google/generative-ai',
    originalName: 'GoogleGenerativeAI',
    importStyle: 'named',
    factoryName: 'createGemini',
    spanlensSdk: '@spanlens/sdk/gemini',
    argShape: 'string',
  },
}

export interface PatchPlan {
  filepath: string
  provider: Provider
  changes: string[] // human-readable diff summary
}

export interface PatchResult {
  filepath: string
  provider: Provider
  patched: boolean
  reason?: string
}

const CANDIDATE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs'])

const EXCLUDE_DIRS = new Set([
  'node_modules',
  '.next',
  'dist',
  'build',
  '.turbo',
  '.vercel',
  'coverage',
  '.git',
])

function listCandidateFiles(cwd: string): string[] {
  const out: string[] = []
  walk(cwd, out, 0)
  return out
}

function walk(dir: string, out: string[], depth: number): void {
  if (depth > 12) return
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const name of entries) {
    if (name.startsWith('.') && !['.env', '.env.local'].includes(name)) {
      if (EXCLUDE_DIRS.has(name)) continue
    }
    if (EXCLUDE_DIRS.has(name)) continue
    const full = join(dir, name)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      walk(full, out, depth + 1)
    } else if (st.isFile()) {
      const dotIdx = name.lastIndexOf('.')
      if (dotIdx < 0) continue
      const ext = name.slice(dotIdx)
      if (CANDIDATE_EXTENSIONS.has(ext)) {
        out.push(full)
      }
    }
  }
}

/**
 * Cheap text-level pre-filter so ts-morph only parses files that actually
 * import the provider client.
 */
function mightContainProvider(filepath: string, cfg: ProviderConfig): boolean {
  try {
    const src = readFileSync(filepath, 'utf8')
    return (
      src.includes(`from '${cfg.importedFrom}'`) ||
      src.includes(`from "${cfg.importedFrom}"`) ||
      src.includes(`new ${cfg.originalName}(`)
    )
  } catch {
    return false
  }
}

/**
 * Scan `cwd` for files that import any of the requested provider clients.
 * Returns one plan per file × provider pairing — a single file may produce
 * multiple plans if it uses more than one provider.
 */
export async function planPatches(cwd: string, providers: Provider[]): Promise<PatchPlan[]> {
  if (providers.length === 0) return []

  const candidates = listCandidateFiles(cwd)
  const project = new Project({ useInMemoryFileSystem: false, skipAddingFilesFromTsConfig: true })
  const plans: PatchPlan[] = []

  for (const provider of providers) {
    const cfg = PROVIDER_CONFIGS[provider]
    const matching = candidates.filter((f) => mightContainProvider(f, cfg))
    for (const filepath of matching) {
      const sf = project.addSourceFileAtPath(filepath)
      const changes = planFileInternal(sf, cfg)
      if (changes.length > 0) plans.push({ filepath, provider, changes })
      project.removeSourceFile(sf)
    }
  }

  return plans
}

/**
 * Apply patches in plan order. Multiple plans may target the same file
 * (different providers) — we re-open the file each time so each run sees
 * the prior provider's edits.
 */
export async function applyPatches(
  plans: PatchPlan[],
  opts: { dryRun?: boolean } = {},
): Promise<PatchResult[]> {
  const results: PatchResult[] = []

  for (const plan of plans) {
    const cfg = PROVIDER_CONFIGS[plan.provider]
    const project = new Project({ useInMemoryFileSystem: false, skipAddingFilesFromTsConfig: true })
    const sf = project.addSourceFileAtPath(plan.filepath)
    const { changed, reason } = patchFileInternal(sf, cfg)
    if (changed && !opts.dryRun) {
      writeFileSync(plan.filepath, sf.getFullText(), 'utf8')
    }
    results.push({
      filepath: plan.filepath,
      provider: plan.provider,
      patched: changed,
      ...(reason ? { reason } : {}),
    })
    project.removeSourceFile(sf)
  }

  return results
}

function planFileInternal(sf: SourceFile, cfg: ProviderConfig): string[] {
  const changes: string[] = []
  const found = findProviderImport(sf, cfg)
  if (!found) return changes

  const calls = findNewCalls(sf, found.localName)
  if (calls.length === 0) return changes

  changes.push(
    `import: "${found.localName}" from '${cfg.importedFrom}' → { ${cfg.factoryName} } from '${cfg.spanlensSdk}'`,
  )
  changes.push(`${calls.length} × new ${found.localName}(...) → ${cfg.factoryName}(...)`)
  return changes
}

function patchFileInternal(sf: SourceFile, cfg: ProviderConfig): { changed: boolean; reason?: string } {
  const found = findProviderImport(sf, cfg)
  if (!found) return { changed: false, reason: `no ${cfg.originalName} import` }

  const calls = findNewCalls(sf, found.localName)
  if (calls.length === 0) return { changed: false, reason: `no new ${cfg.originalName}(...) call` }

  // Replace the import declaration in place.
  const newImport = `import { ${cfg.factoryName} } from '${cfg.spanlensSdk}'`
  found.decl.replaceWithText(newImport)

  for (const newExpr of calls) {
    const args = newExpr.getArguments()
    if (args.length === 0) {
      newExpr.replaceWithText(`${cfg.factoryName}()`)
      continue
    }
    if (cfg.argShape === 'string') {
      // Positional apiKey constructor (Gemini). Drop the arg entirely —
      // createGemini() reads SPANLENS_API_KEY from env.
      newExpr.replaceWithText(`${cfg.factoryName}()`)
      continue
    }
    // 'options' shape — keep all props except apiKey/baseURL.
    const firstArg = args[0]
    if (firstArg && firstArg.getKind() === SyntaxKind.ObjectLiteralExpression) {
      const objText = stripApiKeyAndBaseUrlProps(firstArg.getText())
      newExpr.replaceWithText(`${cfg.factoryName}(${objText})`)
    } else {
      // Unusual non-object arg — just swap the constructor name.
      const argsText = args.map((a) => a.getText()).join(', ')
      newExpr.replaceWithText(`${cfg.factoryName}(${argsText})`)
    }
  }

  return { changed: true }
}

interface FoundImport {
  decl: import('ts-morph').ImportDeclaration
  localName: string
}

function findProviderImport(sf: SourceFile, cfg: ProviderConfig): FoundImport | null {
  for (const decl of sf.getImportDeclarations()) {
    if (decl.getModuleSpecifierValue() !== cfg.importedFrom) continue

    if (cfg.importStyle === 'default') {
      const defaultImport = decl.getDefaultImport()
      if (!defaultImport) continue
      return { decl, localName: defaultImport.getText() }
    }

    // Named import: locate the binding for the original name (allow renaming).
    for (const spec of decl.getNamedImports()) {
      if (spec.getName() === cfg.originalName) {
        const alias = spec.getAliasNode()
        return { decl, localName: alias ? alias.getText() : spec.getName() }
      }
    }
  }
  return null
}

function findNewCalls(sf: SourceFile, localName: string): import('ts-morph').NewExpression[] {
  const matches: import('ts-morph').NewExpression[] = []
  sf.forEachDescendant((node: Node) => {
    if (node.getKind() === SyntaxKind.NewExpression) {
      const newExpr = node.asKindOrThrow(SyntaxKind.NewExpression)
      if (newExpr.getExpression().getText() === localName) {
        matches.push(newExpr)
      }
    }
  })
  return matches
}

/**
 * Remove `apiKey` and `baseURL` from an object literal text. Other props,
 * comments, and trailing commas are preserved.
 */
function stripApiKeyAndBaseUrlProps(objText: string): string {
  const project = new Project({ useInMemoryFileSystem: true })
  const sf = project.createSourceFile('tmp.ts', `const _ = ${objText}`)
  const varStmt = sf.getVariableStatements()[0]
  if (!varStmt) return objText
  const init = varStmt.getDeclarations()[0]?.getInitializer()
  if (!init || init.getKind() !== SyntaxKind.ObjectLiteralExpression) return objText

  const obj = init.asKindOrThrow(SyntaxKind.ObjectLiteralExpression)
  const toRemove: import('ts-morph').PropertyAssignment[] = []
  for (const prop of obj.getProperties()) {
    if (prop.getKind() === SyntaxKind.PropertyAssignment) {
      const pa = prop.asKindOrThrow(SyntaxKind.PropertyAssignment)
      const name = pa.getName()
      if (name === 'apiKey' || name === 'baseURL' || name === '"apiKey"' || name === '"baseURL"') {
        toRemove.push(pa)
      }
    }
  }
  for (const p of toRemove.reverse()) p.remove()

  const result = obj.getText().trim()
  if (/^\{\s*\}$/.test(result)) return ''
  return result
}

export const _test = { stripApiKeyAndBaseUrlProps }
