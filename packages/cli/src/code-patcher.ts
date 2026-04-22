import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Project, SyntaxKind, type SourceFile, type Node } from 'ts-morph'

/**
 * AST-based patcher that rewrites:
 *
 *   import OpenAI from 'openai'
 *   const openai = new OpenAI({ apiKey: ..., baseURL: ... })
 *
 * into:
 *
 *   import { createOpenAI } from '@spanlens/sdk/openai'
 *   const openai = createOpenAI({ ...otherOptions })   // apiKey + baseURL removed
 *
 * Scope: MVP handles the common Next.js pattern (default OpenAI import at
 * module top + `new OpenAI({...})` call). We don't rewrite arbitrary
 * aliases / destructured imports / re-exports in this version.
 */

export interface PatchPlan {
  filepath: string
  changes: string[]  // human-readable diff summary
}

export interface PatchResult {
  filepath: string
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

/** Walk a directory tree, collecting TS/JS file paths. Skips heavy dirs. */
function listCandidateFiles(cwd: string): string[] {
  const out: string[] = []
  walk(cwd, out, 0)
  return out
}

function walk(dir: string, out: string[], depth: number): void {
  if (depth > 12) return // runaway safety
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const name of entries) {
    if (name.startsWith('.') && !['.env', '.env.local'].includes(name)) {
      // skip dotfiles/dotdirs except noteworthy ones (wizard never needs them here anyway)
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
 * Quick text-level pre-filter so we only parse files that actually import
 * OpenAI — ts-morph is slow on large projects.
 */
function mightContainOpenAIClient(filepath: string): boolean {
  try {
    const src = readFileSync(filepath, 'utf8')
    return (
      src.includes("from 'openai'") || src.includes('from "openai"') ||
      src.includes('new OpenAI(')
    )
  } catch {
    return false
  }
}

/**
 * Scan project for files matching the pattern we can patch. Returns a plan
 * without touching files.
 */
export async function planPatches(cwd: string): Promise<PatchPlan[]> {
  const candidates = listCandidateFiles(cwd)
  const matching = candidates.filter(mightContainOpenAIClient)
  if (matching.length === 0) return []

  const project = new Project({ useInMemoryFileSystem: false, skipAddingFilesFromTsConfig: true })
  const plans: PatchPlan[] = []

  for (const filepath of matching) {
    const sf = project.addSourceFileAtPath(filepath)
    const plan = planFileInternal(sf)
    if (plan.changes.length > 0) {
      plans.push({ filepath, changes: plan.changes })
    }
    project.removeSourceFile(sf)
  }

  return plans
}

/**
 * Apply patches listed in plan. Writes files in place unless `dryRun`.
 */
export async function applyPatches(
  plans: PatchPlan[],
  opts: { dryRun?: boolean } = {},
): Promise<PatchResult[]> {
  const project = new Project({ useInMemoryFileSystem: false, skipAddingFilesFromTsConfig: true })
  const results: PatchResult[] = []

  for (const plan of plans) {
    const sf = project.addSourceFileAtPath(plan.filepath)
    const { changed, reason } = patchFileInternal(sf)
    if (changed && !opts.dryRun) {
      writeFileSync(plan.filepath, sf.getFullText(), 'utf8')
    }
    results.push({
      filepath: plan.filepath,
      patched: changed,
      ...(reason ? { reason } : {}),
    })
    project.removeSourceFile(sf)
  }

  return results
}

/** Inspect a source file and describe what we'd change (no mutation). */
function planFileInternal(sf: SourceFile): { changes: string[] } {
  const changes: string[] = []
  const openaiImport = findOpenAIDefaultImport(sf)
  if (!openaiImport) return { changes }

  const calls = findNewOpenAICalls(sf, openaiImport.localName)
  if (calls.length === 0) return { changes }

  changes.push(
    `import: "${openaiImport.localName}" from 'openai' → { createOpenAI } from '@spanlens/sdk/openai'`,
  )
  changes.push(`${calls.length} × new ${openaiImport.localName}({...}) → createOpenAI({...})`)

  return { changes }
}

/** Perform the rewrite. Returns { changed, reason? }. */
function patchFileInternal(sf: SourceFile): { changed: boolean; reason?: string } {
  const openaiImport = findOpenAIDefaultImport(sf)
  if (!openaiImport) return { changed: false, reason: 'no OpenAI default import' }

  const calls = findNewOpenAICalls(sf, openaiImport.localName)
  if (calls.length === 0) return { changed: false, reason: 'no new OpenAI(...) call' }

  // Step 1: replace import. We keep original import's position — modify in place
  // by removing the old import declaration and inserting the new one.
  const oldImportDecl = openaiImport.decl
  const importText = `import { createOpenAI } from '@spanlens/sdk/openai'`
  oldImportDecl.replaceWithText(importText)

  // Step 2: transform each `new OpenAI({...})` expression
  for (const newExpr of calls) {
    const args = newExpr.getArguments()
    if (args.length === 0) {
      newExpr.replaceWithText(`createOpenAI()`)
      continue
    }
    const firstArg = args[0]
    if (firstArg && firstArg.getKind() === SyntaxKind.ObjectLiteralExpression) {
      const objText = stripApiKeyAndBaseUrlProps(firstArg.getText())
      newExpr.replaceWithText(`createOpenAI(${objText})`)
    } else {
      // Non-object arg (unlikely) — just swap the constructor
      const argsText = args.map((a) => a.getText()).join(', ')
      newExpr.replaceWithText(`createOpenAI(${argsText})`)
    }
  }

  return { changed: true }
}

interface OpenAIImport {
  decl: import('ts-morph').ImportDeclaration
  localName: string
}

function findOpenAIDefaultImport(sf: SourceFile): OpenAIImport | null {
  for (const decl of sf.getImportDeclarations()) {
    const moduleSpec = decl.getModuleSpecifierValue()
    if (moduleSpec !== 'openai') continue
    const defaultImport = decl.getDefaultImport()
    if (!defaultImport) continue
    return { decl, localName: defaultImport.getText() }
  }
  return null
}

function findNewOpenAICalls(sf: SourceFile, localName: string): import('ts-morph').NewExpression[] {
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
 * Remove `apiKey` and `baseURL` properties from an object literal text.
 * Preserves other properties, comments, and trailing commas.
 *
 * Input: "{ apiKey: process.env.SPANLENS_API_KEY, baseURL: '...', timeout: 5000 }"
 * Output: "{ timeout: 5000 }"
 * Or if empty: "()" essentially
 */
function stripApiKeyAndBaseUrlProps(objText: string): string {
  // Use a tiny sub-AST to avoid fragile regexes
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
  // Remove in reverse to keep indices valid
  for (const p of toRemove.reverse()) {
    p.remove()
  }

  const result = obj.getText().trim()
  // If object is empty now (possibly with whitespace), return empty string
  // so caller can emit `createOpenAI()` rather than `createOpenAI({})`.
  if (/^\{\s*\}$/.test(result)) return ''
  return result
}

// Export internals for unit tests
export const _test = { stripApiKeyAndBaseUrlProps }
