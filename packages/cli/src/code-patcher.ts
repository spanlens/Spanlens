import { readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { NewLineKind, Project } from 'ts-morph'
import { PROVIDER_CONFIGS, type Provider, type ProviderConfig } from './providers.js'
import { findNewCalls, formatManualEdit, planCall, type CallPlan, type ManualEdit } from './patch-calls.js'
import { stripCredentialProps } from './patch-options.js'
import { findUnsupportedCalls, type UnsupportedCall } from './patch-bindings.js'
import {
  factoryImportText,
  findProviderImport,
  hasFactoryImport,
  rewriteProviderImport,
  type ImportChange,
} from './patch-imports.js'
import { findIntroducedProblems } from './patch-check.js'
import { commitWrites, PatchWriteError, restoreBackups, type FileBackup } from './file-writes.js'

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
 * Safety rules (see patch-calls.ts, patch-options.ts, patch-imports.ts):
 *   - Only inline object-literal options with statically known keys are
 *     rewritten. Variables, spreads, and computed keys are reported as
 *     manual edits, never passed through to the factory.
 *   - Credential and gateway entries of `defaultHeaders` / `defaultQuery`
 *     are removed; a custom `fetch`, `fetchOptions.headers`, or headers the
 *     wizard cannot read send the call to a manual edit. Azure OpenAI
 *     clients are never switched to createOpenAI().
 *   - Clients created through `require()`, `import()`, or a namespace import
 *     are reported as manual edits instead of being skipped silently.
 *   - The provider import is kept (or only our binding is dropped) while the
 *     file still uses it as a type, namespace, instanceof target, or named
 *     import such as `APIError`.
 *   - Every patched file is compiled in memory before and after; a patch that
 *     introduces a syntax error or an unresolved name is not written.
 *   - Writes are all-or-nothing and return backups for a later rollback.
 *
 * Scope: default/named import at module top + `new XxxClient(...)` calls.
 * Re-exports and dynamic imports are not rewritten.
 */

export type { Provider } from './providers.js'
export type { ManualEdit } from './patch-calls.js'
export type { FileBackup, RestoreReport } from './file-writes.js'
export { formatManualEdit, restoreBackups, PatchWriteError }

export interface PatchPlan {
  filepath: string
  provider: Provider
  /** Human-readable summary of the automatic changes. Empty when every call needs a manual edit. */
  changes: string[]
  /** Calls the wizard will leave untouched, with exact instructions. */
  manual: ManualEdit[]
}

export interface PatchResult {
  filepath: string
  provider: Provider
  patched: boolean
  reason?: string
  /** Set when the pre-write compile check rejected this file's patch. */
  problems?: string[]
  manual: ManualEdit[]
}

export interface ApplyResult {
  results: PatchResult[]
  /** Original contents of every file written. Empty on a dry run. */
  backups: FileBackup[]
}

interface TransformOutcome {
  text: string
  changed: boolean
  autoCalls: number
  importChange: ImportChange | null
  /** Nested option entries (credential headers) removed from the rewritten calls. */
  removed: string[]
  manual: ManualEdit[]
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
      if (CANDIDATE_EXTENSIONS.has(name.slice(dotIdx))) out.push(full)
    }
  }
}

/**
 * Cheap text-level pre-filter so ts-morph only parses files that actually
 * load the provider package.
 */
function mightContainProvider(src: string, cfg: ProviderConfig): boolean {
  const loads = [`'${cfg.importedFrom}'`, `"${cfg.importedFrom}"`].some(
    (quoted) => src.includes(`from ${quoted}`) || src.includes(`require(${quoted})`) || src.includes(`import(${quoted})`),
  )
  return loads || src.includes(`new ${cfg.originalName}(`)
}

function readText(filepath: string): string | null {
  try {
    return readFileSync(filepath, 'utf8')
  } catch {
    return null
  }
}

/**
 * Scan `cwd` for files that import any of the requested provider clients.
 * Returns one plan per file × provider pairing — a single file may produce
 * multiple plans if it uses more than one provider. A plan with no automatic
 * changes still appears when it has manual edits to report.
 */
export async function planPatches(cwd: string, providers: Provider[]): Promise<PatchPlan[]> {
  if (providers.length === 0) return []

  const candidates = listCandidateFiles(cwd)
  const plans: PatchPlan[] = []

  for (const provider of providers) {
    const cfg = PROVIDER_CONFIGS[provider]
    for (const filepath of candidates) {
      const src = readText(filepath)
      if (src === null || !mightContainProvider(src, cfg)) continue
      const outcome = transformSource(src, filepath, provider)
      if (outcome.autoCalls > 0 || outcome.manual.length > 0) {
        plans.push({ filepath, provider, changes: describeChanges(outcome, cfg), manual: outcome.manual })
      }
    }
  }

  return plans
}

/**
 * Apply patches. Plans that target the same file (different providers) are
 * applied in order on the same in-memory text, then every changed file goes
 * through the pre-write compile check, and the survivors are written
 * all-or-nothing.
 */
export async function applyPatches(
  plans: PatchPlan[],
  opts: { dryRun?: boolean } = {},
): Promise<ApplyResult> {
  const staged = stageFiles(plans)
  const changed = staged.filter((s) => s.text !== s.original)
  const problems = findIntroducedProblems(
    changed.map((s) => ({ filepath: s.filepath, before: s.original, after: s.text })),
  )

  const writable = changed.filter((s) => !problems.has(s.filepath))
  const backups = opts.dryRun
    ? []
    : commitWrites(writable.map((s) => ({ filepath: s.filepath, original: s.original, text: s.text })))

  const results = staged.flatMap((s) =>
    s.outcomes.map(({ provider, outcome }): PatchResult => {
      const blocked = outcome.changed ? problems.get(s.filepath) : undefined
      const reason = blocked ? 'left unchanged: the patched file would not compile' : outcome.reason
      return {
        filepath: s.filepath,
        provider,
        patched: outcome.changed && !blocked,
        ...(reason ? { reason } : {}),
        ...(blocked ? { problems: blocked } : {}),
        manual: outcome.manual,
      }
    }),
  )

  return { results, backups }
}

interface StagedFile {
  filepath: string
  original: string
  text: string
  outcomes: { provider: Provider; outcome: TransformOutcome }[]
}

function stageFiles(plans: readonly PatchPlan[]): StagedFile[] {
  const byFile = new Map<string, Provider[]>()
  for (const plan of plans) {
    const providers = byFile.get(plan.filepath) ?? []
    if (!providers.includes(plan.provider)) byFile.set(plan.filepath, [...providers, plan.provider])
  }

  return [...byFile.entries()].map(([filepath, providers]) => {
    const original = readFileSync(filepath, 'utf8')
    let text = original
    const outcomes: StagedFile['outcomes'] = []
    for (const provider of providers) {
      const outcome = transformSource(text, filepath, provider)
      text = outcome.text
      outcomes.push({ provider, outcome })
    }
    return { filepath, original, text, outcomes }
  })
}

/** Rewrite one provider's usage in `text`. Pure: works on an in-memory copy. */
function transformSource(text: string, filepath: string, provider: Provider): TransformOutcome {
  const cfg = PROVIDER_CONFIGS[provider]
  const unchanged = (reason: string, manual: ManualEdit[] = []): TransformOutcome => ({
    text,
    changed: false,
    autoCalls: 0,
    importChange: null,
    removed: [],
    manual,
    reason,
  })

  const project = new Project({
    useInMemoryFileSystem: true,
    manipulationSettings: {
      newLineKind: text.includes('\r\n') ? NewLineKind.CarriageReturnLineFeed : NewLineKind.LineFeed,
    },
  })
  const sf = project.createSourceFile(`/src/${basename(filepath)}`, text)

  const found = findProviderImport(sf, cfg)
  const calls = [
    ...(found ? findNewCalls(sf, found.localName).map((node) => planCall(node, provider, cfg)) : []),
    ...findUnsupportedCalls(sf, cfg, found?.localName ?? null).map((call) => unsupportedPlan(call, provider, cfg)),
  ]
  if (calls.length === 0) {
    return unchanged(found ? `no new ${cfg.originalName}(...) call` : `no ${cfg.originalName} import`)
  }

  const autos = calls.filter((c): c is Extract<CallPlan, { kind: 'auto' }> => c.kind === 'auto')
  const manuals = calls.filter((c): c is Extract<CallPlan, { kind: 'manual' }> => c.kind === 'manual')

  if (autos.length === 0 || !found) {
    const importLine = hasFactoryImport(sf, cfg) ? null : factoryImportText(cfg, found?.decl ?? null)
    return unchanged(
      'every call needs a manual edit',
      manuals.map((m) => toManualEdit(m, importLine)),
    )
  }

  const linesBefore = new Map(manuals.map((m) => [m, m.node.getStartLineNumber()]))
  // Replace from the end so earlier positions stay valid.
  for (const call of [...autos].reverse()) call.node.replaceWithText(call.replacement)
  const { change } = rewriteProviderImport(sf, findProviderImport(sf, cfg) ?? found, cfg)

  return {
    text: sf.getFullText(),
    changed: true,
    autoCalls: autos.length,
    importChange: change,
    removed: [...new Set(autos.flatMap((call) => call.removed))],
    // Lines are read after the rewrite: that is the file the user will edit.
    manual: manuals.map((m) => toManualEdit(m, null, linesBefore.get(m))),
  }
}

const ESM_ONLY_CAUTION = '@spanlens/sdk is an ES module, so load it with `import` (or `await import()` from CommonJS).'

/**
 * A call through `require()`, `import()`, or a namespace import is never
 * rewritten. It is reported with the replacement a supported import would
 * get, so the user sees exactly what to change.
 */
function unsupportedPlan(call: UnsupportedCall, provider: Provider, cfg: ProviderConfig): CallPlan {
  const inner = planCall(call.node, provider, cfg)
  const base =
    inner.kind === 'auto'
      ? { suggested: inner.replacement, unknownSources: [] as readonly string[], cautions: [] as readonly string[] }
      : inner.edit
  return {
    kind: 'manual',
    node: call.node,
    edit: {
      provider,
      original: call.node.getText(),
      suggested: base.suggested,
      unknownSources: base.unknownSources,
      mustNotSet: cfg.credentialProps,
      cautions: call.commonJs ? [...base.cautions, ESM_ONLY_CAUTION] : base.cautions,
      reason: `The client comes from ${call.source}, which the wizard does not rewrite.`,
    },
  }
}

function toManualEdit(
  call: Extract<CallPlan, { kind: 'manual' }>,
  factoryImport: string | null,
  fallbackLine?: number,
): ManualEdit {
  const line = call.node.wasForgotten() ? (fallbackLine ?? 0) : call.node.getStartLineNumber()
  // No replacement means the call must not be switched, so no import either.
  return { ...call.edit, line, factoryImport: call.edit.suggested === null ? null : factoryImport }
}

function describeChanges(outcome: TransformOutcome, cfg: ProviderConfig): string[] {
  if (outcome.autoCalls === 0 || !outcome.importChange) return []
  const target = `{ ${cfg.factoryName} } from '${cfg.spanlensSdk}'`
  const name = cfg.originalName
  const source = `'${cfg.importedFrom}'`
  const importLine = ((): string => {
    switch (outcome.importChange.kind) {
      case 'replaced':
        return `import: "${name}" from ${source} → ${target}`
      case 'binding-removed':
        return `import: drop "${name}" from ${source} (keeps ${outcome.importChange.kept.join(', ')}), add ${target}`
      case 'kept':
        return `import: keep ${source} ("${name}" is still used in this file), add ${target}`
    }
  })()
  const lines = [importLine, `${outcome.autoCalls} × new ${name}(...) → ${cfg.factoryName}(...)`]
  if (outcome.removed.length > 0) {
    lines.push(`options: removed ${outcome.removed.join(', ')} (credentials and gateway settings must not reach Spanlens)`)
  }
  if (outcome.manual.length > 0) {
    lines.push(`${outcome.manual.length} × new ${name}(...) left unchanged, needs a manual edit`)
  }
  return lines
}

export const _test = { stripCredentialProps, findIntroducedProblems, commitWrites }
