import * as p from '@clack/prompts'
import pc from 'picocolors'
import { installPackage, isAlreadyInstalled, type PackageManager } from './installer.js'
import { MIN_SDK_FOR_SERVER_URL, SDK_PACKAGE, checkServerUrlSupport } from './sdk-version.js'

/**
 * The wizard step that makes sure the project has `@spanlens/sdk`, and for a
 * self-hosted server (`--server-url`) that the installed version reads
 * SPANLENS_BASE_URL. An older SDK ignores that variable and sends requests,
 * prompts included, and the self-hosted key to the hosted service, so the
 * wizard upgrades it or stops before it patches any code.
 */

export interface SdkStepInput {
  cwd: string
  pm: PackageManager
  dryRun: boolean
  /** Normalized origin of a self-hosted server, or null for the hosted service. */
  serverUrl: string | null
}

export type SdkStepResult =
  /** `readsServerUrl`: the installed SDK was checked and honours SPANLENS_BASE_URL. */
  | { kind: 'continue'; readsServerUrl: boolean }
  /** Setup must not go on; `message` says why and what to do. */
  | { kind: 'stop'; message: string }
  /** The user cancelled a prompt. */
  | { kind: 'cancelled' }

export interface SdkStepDeps {
  install: typeof installPackage
}

type InstallOutcome = 'present' | 'installed' | 'failed' | 'skipped' | 'cancelled'

export async function runSdkStep(
  input: SdkStepInput,
  deps: SdkStepDeps = { install: installPackage },
): Promise<SdkStepResult> {
  const installed = await ensureInstalled(input, deps)
  if (installed === 'cancelled') return { kind: 'cancelled' }
  if (!input.serverUrl) return { kind: 'continue', readsServerUrl: false }

  if (input.dryRun) {
    p.log.info(`${requirement()} The real run checks the installed version.`)
    return { kind: 'continue', readsServerUrl: false }
  }
  if (installed === 'skipped' || installed === 'failed') {
    p.log.warn(`${requirement()} Install it before you deploy.`)
    return { kind: 'continue', readsServerUrl: false }
  }
  return checkSelfHostedSdk(input, deps, installed === 'installed')
}

async function ensureInstalled(input: SdkStepInput, deps: SdkStepDeps): Promise<InstallOutcome> {
  if (isAlreadyInstalled(input.cwd, SDK_PACKAGE)) {
    p.log.success(`${SDK_PACKAGE} already in dependencies`)
    return 'present'
  }

  const shouldInstall = await p.confirm({
    message: `Install ${SDK_PACKAGE} now via ${pc.cyan(input.pm)}?`,
    initialValue: true,
  })
  if (p.isCancel(shouldInstall)) return 'cancelled'
  if (!shouldInstall) {
    p.log.warn(`Skipped the SDK install. Install ${SDK_PACKAGE} yourself before you deploy.`)
    return 'skipped'
  }

  const s = p.spinner()
  s.start(`Installing ${SDK_PACKAGE} with ${input.pm}`)
  const result = await deps.install(input.cwd, input.pm, SDK_PACKAGE, { dryRun: input.dryRun, silent: true })
  if (!result.ok) {
    s.stop(pc.yellow('Auto-install failed. Install it manually:'))
    p.log.message(`  ${pc.cyan(result.command)}`)
    if (result.error) p.log.message(pc.dim(`  (${result.error})`))
    return 'failed'
  }
  s.stop(input.dryRun ? `[dry-run] would run: ${pc.cyan(result.command)}` : `Installed ${SDK_PACKAGE} (${result.command})`)
  return 'installed'
}

async function checkSelfHostedSdk(
  input: SdkStepInput,
  deps: SdkStepDeps,
  justInstalled: boolean,
): Promise<SdkStepResult> {
  const support = checkServerUrlSupport(input.cwd)
  switch (support.kind) {
    case 'supported':
      p.log.success(`${SDK_PACKAGE} ${support.version} reads SPANLENS_BASE_URL`)
      return { kind: 'continue', readsServerUrl: true }
    case 'not-installed':
      p.log.warn(
        `Could not find ${SDK_PACKAGE} in node_modules, so the wizard cannot confirm that it reads SPANLENS_BASE_URL. ${requirement()} Run your package manager's install before you deploy.`,
      )
      return { kind: 'continue', readsServerUrl: false }
    case 'too-old':
      // A fresh install already fetched the newest release, so upgrading again cannot help.
      if (justInstalled) return { kind: 'stop', message: newestTooOld(input.pm, support.version) }
      return upgrade(input, deps, support.version)
  }
}

async function upgrade(input: SdkStepInput, deps: SdkStepDeps, version: string): Promise<SdkStepResult> {
  const answer = await p.confirm({
    message: `${SDK_PACKAGE} ${version} ignores SPANLENS_BASE_URL, so your app would send its requests to the hosted service. Upgrade it now via ${pc.cyan(input.pm)}?`,
    initialValue: true,
  })
  if (p.isCancel(answer)) return { kind: 'cancelled' }
  if (!answer) return { kind: 'stop', message: tooOld(version) }

  const s = p.spinner()
  s.start(`Upgrading ${SDK_PACKAGE} with ${input.pm}`)
  const result = await deps.install(input.cwd, input.pm, `${SDK_PACKAGE}@latest`, { silent: true })
  if (!result.ok) {
    s.stop(pc.red(`Could not upgrade ${SDK_PACKAGE}`))
    p.log.message(`  ${pc.cyan(result.command)}`)
    if (result.error) p.log.message(pc.dim(`  (${result.error})`))
    return { kind: 'stop', message: tooOld(version) }
  }

  const after = checkServerUrlSupport(input.cwd)
  if (after.kind === 'supported') {
    s.stop(`Upgraded ${SDK_PACKAGE} from ${version} to ${after.version}`)
    return { kind: 'continue', readsServerUrl: true }
  }
  s.stop(pc.yellow(`${SDK_PACKAGE} still does not read SPANLENS_BASE_URL`))
  return { kind: 'stop', message: after.kind === 'too-old' ? newestTooOld(input.pm, after.version) : tooOld(version) }
}

function requirement(): string {
  return `Self-hosted Spanlens needs ${SDK_PACKAGE} ${MIN_SDK_FOR_SERVER_URL} or later. Older versions ignore SPANLENS_BASE_URL and send requests to the hosted service.`
}

function tooOld(version: string): string {
  return `Self-hosted Spanlens needs ${SDK_PACKAGE} ${MIN_SDK_FOR_SERVER_URL} or later. Version ${version} ignores SPANLENS_BASE_URL, so your app would send its requests, prompts included, and your Spanlens key to the hosted service. Upgrade ${SDK_PACKAGE} and run the wizard again.`
}

function newestTooOld(pm: PackageManager, version: string): string {
  return `${pm} installed ${SDK_PACKAGE} ${version}, which does not read SPANLENS_BASE_URL yet. Self-hosted Spanlens needs ${MIN_SDK_FOR_SERVER_URL} or later, because older versions send requests and your Spanlens key to the hosted service. Run the wizard again once ${SDK_PACKAGE} ${MIN_SDK_FOR_SERVER_URL} is published.`
}
