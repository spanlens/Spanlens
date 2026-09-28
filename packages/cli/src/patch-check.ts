import { extname } from 'node:path'
import { Project, ts, type Diagnostic, type SourceFile } from 'ts-morph'

/**
 * Pre-write safety net. Before anything touches disk, both the original and
 * the patched text of every file are compiled in memory, and the patch is
 * rejected for a file if it introduces a syntax error or a broken name
 * binding (a name that no longer resolves, or one declared twice).
 *
 * This runs for JavaScript projects too, which have no project-level
 * `tsc --noEmit` gate. There is no node_modules in memory, so every import
 * resolves to `any`; only diagnostics about name bindings and syntax are
 * compared, and only as a before/after delta.
 */

export interface CheckEntry {
  filepath: string
  before: string
  after: string
}

/** Diagnostic codes that mean "a name binding is broken or duplicated". */
const BINDING_CODES = new Set([
  2300, // Duplicate identifier '{0}'.
  2304, // Cannot find name '{0}'.
  2440, // Import declaration conflicts with local declaration of '{0}'.
  2451, // Cannot redeclare block-scoped variable '{0}'.
  2503, // Cannot find namespace '{0}'.
  2552, // Cannot find name '{0}'. Did you mean '{1}'?
  2833, // Cannot find namespace '{0}'. Did you mean '{1}'?
  2749, // '{0}' refers to a value, but is being used as a type here.
  2693, // '{0}' only refers to a type, but is being used as a value here.
])

/** Map of filepath → human-readable problems the patch introduced. */
export function findIntroducedProblems(entries: readonly CheckEntry[]): Map<string, string[]> {
  const problems = new Map<string, string[]>()
  if (entries.length === 0) return problems

  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: {
      allowJs: true,
      checkJs: true,
      noEmit: true,
      jsx: ts.JsxEmit.Preserve,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      skipLibCheck: true,
    },
  })
  // Resolve every import to `any`. Without it TypeScript cannot tell whether
  // an import binds a value, and silently skips conflict checks such as
  // "Import declaration conflicts with local declaration".
  project.createSourceFile('/__ambient__.d.ts', `declare module '*';\n`)
  const pairs = entries.map((entry, i) => {
    const ext = extname(entry.filepath) || '.ts'
    return {
      entry,
      before: project.createSourceFile(`/before/f${i}${ext}`, entry.before),
      after: project.createSourceFile(`/after/f${i}${ext}`, entry.after),
    }
  })

  const program = project.getProgram()
  for (const { entry, before, after } of pairs) {
    const introduced = subtract(bindingDiagnostics(program, after), bindingDiagnostics(program, before))
    if (introduced.length > 0) problems.set(entry.filepath, introduced)
  }
  return problems
}

type ProgramLike = ReturnType<Project['getProgram']>

function bindingDiagnostics(program: ProgramLike, sf: SourceFile): string[] {
  const syntactic = program.getSyntacticDiagnostics(sf)
  const semantic = program.getSemanticDiagnostics(sf).filter((d) => BINDING_CODES.has(d.getCode()))
  return [...syntactic, ...semantic].map(describe)
}

function describe(d: Diagnostic): string {
  const raw = d.getMessageText()
  const message = typeof raw === 'string' ? raw : ts.flattenDiagnosticMessageText(raw.compilerObject, ' ')
  const line = d.getLineNumber()
  return `TS${d.getCode()}: ${message}${line ? ` (line ${line})` : ''}`
}

/** Multiset difference keyed on the message without the line suffix. */
function subtract(after: readonly string[], before: readonly string[]): string[] {
  const counts = new Map<string, number>()
  for (const d of before) counts.set(keyOf(d), (counts.get(keyOf(d)) ?? 0) + 1)
  const introduced: string[] = []
  for (const d of after) {
    const left = counts.get(keyOf(d)) ?? 0
    if (left > 0) counts.set(keyOf(d), left - 1)
    else introduced.push(d)
  }
  return introduced
}

function keyOf(description: string): string {
  return description.replace(/ \(line \d+\)$/, '')
}
