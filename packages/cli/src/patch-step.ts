import { relative } from 'node:path'
import * as p from '@clack/prompts'
import pc from 'picocolors'
import {
  applyPatches,
  formatManualEdit,
  planPatches,
  restoreBackups,
  PatchWriteError,
  type ApplyResult,
  type ManualEdit,
  type PatchPlan,
  type Provider,
  type RestoreReport,
} from './code-patcher.js'
import { findLocalTsc, judgeTypecheck, runTsc, type TscRun } from './verify.js'

/**
 * Steps 6 and 7 of the wizard: scan, preview, patch, verify. The verify step
 * runs the project's own `tsc --noEmit` before and after writing; if the
 * patch introduced errors, every patched file is restored and the wizard
 * reports that setup is not finished instead of claiming success.
 */

export type PatchStepStatus =
  | 'patched' // files patched (and verified when possible)
  | 'nothing-found' // no provider constructors in the codebase
  | 'needs-manual' // some call sites were left for the user
  | 'declined' // user said no at the confirmation prompt
  | 'dry-run'
  | 'failed' // scan/write failed, or the patch was rolled back

export interface PatchStepInput {
  cwd: string
  providers: Provider[]
  dryRun: boolean
  /** True for TypeScript projects with a tsconfig.json. */
  typecheck: boolean
}

const MAX_ERROR_LINES = 10

export interface FinalOutcome {
  message: string
  tone: 'success' | 'warning' | 'error'
  exitCode: 0 | 1
  /** Deploy instructions only make sense when the code is (or will be) routed. */
  showNextSteps: boolean
  /** The star/docs CTA is reserved for a finished setup. */
  showCta: boolean
}

/** How the wizard ends. Only a finished setup may say "complete". */
export function finalOutcome(status: PatchStepStatus): FinalOutcome {
  switch (status) {
    case 'patched':
    case 'nothing-found':
      return { message: '🎉 Spanlens setup complete', tone: 'success', exitCode: 0, showNextSteps: true, showCta: true }
    case 'needs-manual':
      return {
        message: 'Almost there: finish the manual edits listed above, and Spanlens setup is complete.',
        tone: 'warning',
        exitCode: 0,
        showNextSteps: true,
        showCta: false,
      }
    case 'declined':
      return {
        message: 'Spanlens setup is not finished: the code patch was skipped. Re-run the wizard when you are ready.',
        tone: 'warning',
        exitCode: 0,
        showNextSteps: false,
        showCta: false,
      }
    case 'dry-run':
      return { message: 'Dry run finished. Nothing was written.', tone: 'success', exitCode: 0, showNextSteps: true, showCta: false }
    case 'failed':
      return {
        message: 'Spanlens setup is not finished. See the errors above.',
        tone: 'error',
        exitCode: 1,
        showNextSteps: false,
        showCta: false,
      }
  }
}

export async function runPatchStep(input: PatchStepInput): Promise<PatchStepStatus> {
  const plans = await scan(input)
  if (plans === null) return 'failed'
  if (plans.length === 0) {
    printNothingFound(input.providers)
    return 'nothing-found'
  }

  printPlans(input.cwd, plans)
  const autoPlans = plans.filter((plan) => plan.changes.length > 0)
  if (autoPlans.length === 0) {
    printManualEdits(input.cwd, plans.map((plan) => ({ filepath: plan.filepath, manual: plan.manual })))
    return 'needs-manual'
  }

  const approve = await p.confirm({
    message: input.dryRun ? 'Dry run: show patch preview?' : 'Apply these changes?',
    initialValue: true,
  })
  if (p.isCancel(approve) || !approve) {
    p.log.warn('Code patch skipped. You can re-run the wizard anytime.')
    return 'declined'
  }

  const tscPath = !input.dryRun && input.typecheck ? findLocalTsc(input.cwd) : null
  if (!input.dryRun && input.typecheck && !tscPath) {
    p.log.warn('TypeScript is not installed in this project, so the wizard cannot type-check the patch. Run tsc --noEmit before you deploy.')
  }
  const baseline = tscPath ? typecheck(input.cwd, tscPath, 'Recording the TypeScript baseline') : null

  const applied = await apply(plans, input.dryRun)
  if (applied === null) return 'failed'

  if (tscPath && baseline && applied.backups.length > 0) {
    const kept = verifyOrRollBack(input.cwd, tscPath, baseline, applied)
    if (!kept) return 'failed'
  }

  const blockedFiles = printBlockedFiles(input.cwd, applied)
  const manualCount = printManualEdits(input.cwd, applied.results)

  if (input.dryRun) return 'dry-run'
  return manualCount > 0 || blockedFiles > 0 ? 'needs-manual' : 'patched'
}

/** Files the pre-write compile check refused to write. Returns how many. */
function printBlockedFiles(cwd: string, applied: ApplyResult): number {
  const byFile = new Map<string, string[]>()
  for (const r of applied.results) {
    if (r.problems) byFile.set(r.filepath, r.problems)
  }
  for (const [filepath, problems] of byFile) {
    p.log.warn(
      `${relative(cwd, filepath)} was left unchanged: the rewrite would not compile. Switch it to the @spanlens/sdk factory by hand.`,
    )
    for (const problem of problems.slice(0, MAX_ERROR_LINES)) p.log.message(pc.dim(`  ${problem}`))
  }
  return byFile.size
}

async function scan(input: PatchStepInput): Promise<PatchPlan[] | null> {
  const s = p.spinner()
  const names = input.providers.length > 0 ? input.providers.map((x) => `\`${x}\``).join(', ') : 'provider'
  s.start(`Scanning codebase for ${names} usage`)
  try {
    const plans = await planPatches(input.cwd, input.providers)
    const auto = plans.filter((plan) => plan.changes.length > 0).length
    s.stop(`Found ${auto} patch${auto === 1 ? '' : 'es'} to apply`)
    return plans
  } catch (err) {
    s.stop(pc.red('Scan failed'))
    p.log.error(err instanceof Error ? err.message : String(err))
    return null
  }
}

async function apply(plans: PatchPlan[], dryRun: boolean): Promise<ApplyResult | null> {
  const s = p.spinner()
  s.start(dryRun ? 'Dry-run patch' : 'Patching files')
  try {
    const applied = await applyPatches(plans, { dryRun })
    const files = new Set(applied.results.filter((r) => r.patched).map((r) => r.filepath)).size
    s.stop(dryRun ? `[dry-run] would patch ${files} file${files === 1 ? '' : 's'}` : `Patched ${files} file${files === 1 ? '' : 's'}`)
    return applied
  } catch (err) {
    s.stop(pc.red('Patch failed'))
    p.log.error(err instanceof Error ? err.message : String(err))
    if (err instanceof PatchWriteError) printRestoreProblems(err.restore)
    return null
  }
}

function typecheck(cwd: string, tscPath: string, label: string): TscRun {
  const s = p.spinner()
  s.start(label)
  const run = runTsc(cwd, tscPath)
  const summary =
    run.kind === 'clean'
      ? 'no errors'
      : run.kind === 'errors'
        ? `${run.diagnostics.length} existing error${run.diagnostics.length === 1 ? '' : 's'}`
        : run.reason
  s.stop(`${label}: ${summary}`)
  return run
}

/** Returns true when the patch stays on disk, false when it was rolled back. */
function verifyOrRollBack(cwd: string, tscPath: string, baseline: TscRun, applied: ApplyResult): boolean {
  const s = p.spinner()
  s.start('Verifying patch with TypeScript')
  const verdict = judgeTypecheck(baseline, runTsc(cwd, tscPath))

  if (verdict.kind === 'passed') {
    s.stop('TypeScript check passed ✓')
    return true
  }
  if (verdict.kind === 'unverified') {
    s.stop(pc.yellow(`Could not finish the TypeScript check: ${verdict.reason}`))
    p.log.warn('The patch is on disk but unverified. Run tsc --noEmit before you deploy.')
    return true
  }

  s.stop(pc.red('The patch introduced TypeScript errors, so every patched file was restored'))
  for (const d of verdict.introduced.slice(0, MAX_ERROR_LINES)) p.log.message(pc.dim(`  ${d.raw}`))
  if (verdict.introduced.length > MAX_ERROR_LINES) {
    p.log.message(pc.dim(`  ...and ${verdict.introduced.length - MAX_ERROR_LINES} more`))
  }
  const report = restoreBackups(applied.backups)
  printRestoreProblems(report)
  const sdkMissing = verdict.introduced.some((d) => d.message.includes(`Cannot find module '@spanlens/sdk`))
  p.log.message(
    sdkMissing
      ? 'TypeScript cannot find @spanlens/sdk. Install it with your package manager and run the wizard again.'
      : 'Switch these files to the @spanlens/sdk factories by hand, and please report the errors at https://github.com/spanlens/Spanlens/issues so the wizard can handle them.',
  )
  return false
}

function printRestoreProblems(report: RestoreReport): void {
  if (report.failed.length === 0) return
  p.log.error('These files could not be restored automatically. Restore them with git restore <file>:')
  for (const f of report.failed) p.log.message(`  ${f.filepath} (${f.error})`)
}

function printNothingFound(providers: readonly Provider[]): void {
  if (providers.length === 0) {
    p.log.message(pc.dim('No providers registered yet, so there is nothing to patch. Add provider keys and re-run.'))
    return
  }
  const importLines = providers
    .map((x) => `  ${pc.dim(`import { create${x[0]!.toUpperCase()}${x.slice(1)} } from "@spanlens/sdk/${x}"`)}`)
    .join('\n')
  p.log.message(pc.dim(`No matching client constructors found. Add manually:\n${importLines}`))
}

function printPlans(cwd: string, plans: readonly PatchPlan[]): void {
  for (const plan of plans) {
    p.log.message(`  ${pc.cyan('•')} [${plan.provider}] ${pc.dim(relative(cwd, plan.filepath))}`)
    for (const change of plan.changes) p.log.message(`      ${pc.dim('→')} ${change}`)
    if (plan.manual.length > 0) {
      p.log.message(`      ${pc.yellow('!')} ${plan.manual.length} call${plan.manual.length === 1 ? '' : 's'} left for a manual edit (details below)`)
    }
  }
}

/** Print every manual edit, once per call site. Returns how many were printed. */
function printManualEdits(cwd: string, items: readonly { filepath: string; manual: ManualEdit[] }[]): number {
  const all = items.flatMap((item) => item.manual.map((edit) => ({ filepath: item.filepath, edit })))
  if (all.length === 0) return 0

  p.log.warn(
    `${all.length} call${all.length === 1 ? '' : 's'} could not be rewritten safely. Requests from ${all.length === 1 ? 'it' : 'them'} will not go through Spanlens until you edit ${all.length === 1 ? 'it' : 'them'} by hand:`,
  )
  const importShown = new Set<string>()
  for (const { filepath, edit } of all) {
    const importKey = `${filepath}\u0000${edit.provider}`
    const shown = importShown.has(importKey)
    importShown.add(importKey)
    const lines = formatManualEdit(relative(cwd, filepath), shown ? { ...edit, factoryImport: null } : edit)
    p.log.message(lines.join('\n'))
  }
  return all.length
}
