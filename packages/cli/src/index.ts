#!/usr/bin/env node
/**
 * @spanlens/cli — onboarding wizard.
 *
 *   npx @spanlens/cli init
 *   npx @spanlens/cli init --dry-run
 *
 * Walks the user through:
 *   1. Confirming dashboard prerequisites (account / project / provider keys / Spanlens key)
 *   2. Validating the pasted Spanlens key against the API (introspects which
 *      provider keys are registered on the project)
 *   3. Writing SPANLENS_API_KEY into .env.local (with overwrite confirmation)
 *   4. Auto-installing @spanlens/sdk
 *   5. Patching `new OpenAI(...)` / `new Anthropic(...)` /
 *      `new GoogleGenerativeAI(...)` based on which providers are registered
 *   6. Running the project's `tsc --noEmit` before and after the patch, and
 *      restoring every patched file if the patch introduced errors
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as p from '@clack/prompts'
import pc from 'picocolors'
import { detectFramework } from './framework-detect.js'
import { upsertEnvVar } from './env-writer.js'
import type { Provider } from './code-patcher.js'
import { parseFlags } from './flags.js'
import { buildNextSteps } from './next-steps.js'
import { finalOutcome, runPatchStep } from './patch-step.js'
import {
  detectPackageManager,
  isAlreadyInstalled,
  installPackage,
} from './installer.js'

const DEFAULT_URL = 'https://www.spanlens.io'

interface KeyInfo {
  projectId: string
  projectName: string
  providers: Provider[]
}

/** Hit /api/v1/me/key-info with the user's Spanlens key. */
async function fetchKeyInfo(apiKey: string, apiBase: string): Promise<KeyInfo> {
  const url = `${apiBase}/api/v1/me/key-info`
  let res: Response
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
  } catch (err) {
    throw new Error(
      `Network error contacting ${apiBase}. Check your connection. (${err instanceof Error ? err.message : String(err)})`,
    )
  }

  if (res.status === 401) {
    throw new Error('Spanlens rejected this key (401). Re-copy it from the dashboard.')
  }
  if (!res.ok) {
    throw new Error(`Spanlens returned ${res.status} from /me/key-info — try again in a moment.`)
  }

  const json = (await res.json().catch(() => ({}))) as { data?: KeyInfo }
  if (!json.data) throw new Error('Unexpected response shape from /me/key-info.')
  return json.data
}

/** Read existing SPANLENS_API_KEY value (if any) from an env file. */
function readExistingEnvVar(cwd: string, filename: string, key: string): string | null {
  const path = resolve(cwd, filename)
  if (!existsSync(path)) return null
  const text = readFileSync(path, 'utf8')
  const match = text.match(new RegExp(`^${key}\\s*=\\s*(.+)$`, 'm'))
  return match?.[1]?.trim() ?? null
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv)

  if (flags.subcommand !== 'init') {
    p.intro(pc.cyan('@spanlens/cli'))
    p.log.warn(`Unknown subcommand: ${flags.subcommand}`)
    p.log.message('Usage:  npx @spanlens/cli init [--dry-run] [--server-url <url>]')
    process.exit(1)
  }
  if (flags.error) {
    p.intro(pc.cyan('@spanlens/cli'))
    p.log.error(flags.error)
    process.exit(1)
  }

  const dashboardUrl = flags.serverUrl ?? DEFAULT_URL
  const apiBase = flags.serverUrl ?? process.env.SPANLENS_API_BASE ?? DEFAULT_URL

  p.intro(pc.cyan('🔭  Spanlens setup'))
  if (flags.serverUrl) {
    p.log.info(`Self-hosted Spanlens server: ${pc.bold(flags.serverUrl)}`)
    if (flags.droppedPath) {
      p.log.warn(
        `Ignored ${pc.bold(flags.droppedPath)} in --server-url. SPANLENS_BASE_URL has to be the server origin, and @spanlens/sdk adds the /proxy/... route itself.`,
      )
    }
  }

  // ── Step 1: framework detection ───────────────────────────────────
  const fw = detectFramework(process.cwd())
  if (fw.framework === 'unknown') {
    p.log.warn(
      `Could not detect a Next.js project in ${pc.dim(process.cwd())}`,
    )
    p.log.message(
      'MVP wizard only supports Next.js. Vite / Express / etc. coming soon — run from your Next.js app root.',
    )
    const proceed = await p.confirm({
      message: 'Continue anyway? (env file + code patching will still run)',
      initialValue: false,
    })
    if (p.isCancel(proceed) || !proceed) {
      p.cancel('Aborted.')
      process.exit(0)
    }
  } else {
    p.log.success(
      `Detected ${pc.bold('Next.js')} ${fw.typescript ? '(TypeScript)' : '(JavaScript)'}`,
    )
  }

  // ── Step 2: prerequisites reminder ────────────────────────────────
  p.log.message('')
  p.log.step(pc.bold('Before continuing, make sure you have:'))
  p.log.message(`  1. A Spanlens account — ${pc.underline(dashboardUrl)}`)
  p.log.message(`  2. A Project at ${pc.underline(dashboardUrl + '/projects')}`)
  p.log.message(`  3. Provider keys (OpenAI / Anthropic / Gemini) added to that project`)
  p.log.message(`  4. A Spanlens key issued for that project (sl_live_…)`)
  p.log.message('')

  const ready = await p.confirm({
    message: 'Ready? (If not, set them up first — everything else is automated)',
    initialValue: true,
  })
  if (p.isCancel(ready) || !ready) {
    p.cancel('Aborted. Come back after setting up the dashboard.')
    process.exit(0)
  }

  // ── Step 3: collect + validate Spanlens API key ───────────────────
  const apiKey = await p.password({
    message: 'Paste your Spanlens key (starts with sl_live_)',
    validate: (v) => {
      if (!v || v.length < 20) return 'Looks too short'
      if (!v.startsWith('sl_live_') && !v.startsWith('sl_test_')) {
        return 'Spanlens keys start with sl_live_ or sl_test_'
      }
      return undefined
    },
  })
  if (p.isCancel(apiKey)) {
    p.cancel('Aborted.')
    process.exit(0)
  }

  // Validate against the API + introspect registered providers.
  const sValidate = p.spinner()
  sValidate.start('Validating key with Spanlens')
  let keyInfo!: KeyInfo
  try {
    keyInfo = await fetchKeyInfo(apiKey, apiBase)
    sValidate.stop(
      `Key valid · project ${pc.bold(keyInfo.projectName)} · providers: ${
        keyInfo.providers.length > 0 ? keyInfo.providers.join(', ') : pc.dim('(none registered)')
      }`,
    )
  } catch (err) {
    sValidate.stop(pc.red('Key validation failed'))
    p.log.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }

  if (keyInfo.providers.length === 0) {
    p.log.warn(
      'No active provider keys on this project — calls will return 400 until you add one.',
    )
    p.log.message(
      `  Add provider keys at ${pc.underline(`${dashboardUrl}/projects`)} → your project → "Add provider key"`,
    )
  }

  // ── Step 4: write .env file (with overwrite confirm) ──────────────
  const existingValue = readExistingEnvVar(process.cwd(), fw.envFile, 'SPANLENS_API_KEY')
  if (existingValue && existingValue !== apiKey) {
    const masked =
      existingValue.length > 16
        ? `${existingValue.slice(0, 12)}…${existingValue.slice(-4)}`
        : '••••'
    const replace = await p.confirm({
      message: `${fw.envFile} already has SPANLENS_API_KEY=${masked} — replace it?`,
      initialValue: false,
    })
    if (p.isCancel(replace) || !replace) {
      p.cancel('Kept existing key. Re-run when ready.')
      process.exit(0)
    }
  }

  const sEnv = p.spinner()
  sEnv.start(`Updating ${fw.envFile}`)
  try {
    if (flags.dryRun) {
      sEnv.stop(`[dry-run] would write SPANLENS_API_KEY${flags.serverUrl ? ' + SPANLENS_BASE_URL' : ''} to ${fw.envFile}`)
    } else {
      const r = upsertEnvVar(process.cwd(), fw.envFile, 'SPANLENS_API_KEY', apiKey)
      if (flags.serverUrl) {
        upsertEnvVar(process.cwd(), fw.envFile, 'SPANLENS_BASE_URL', flags.serverUrl)
      }
      if (r.created) sEnv.stop(`Created ${fw.envFile} with SPANLENS_API_KEY${flags.serverUrl ? ' + SPANLENS_BASE_URL' : ''}`)
      else if (r.changed) sEnv.stop(`Updated SPANLENS_API_KEY in ${fw.envFile}${flags.serverUrl ? ' + wrote SPANLENS_BASE_URL' : ''}`)
      else sEnv.stop(`SPANLENS_API_KEY already up to date in ${fw.envFile}${flags.serverUrl ? ' + wrote SPANLENS_BASE_URL' : ''}`)
    }
  } catch (err) {
    sEnv.stop(pc.red(`Failed to write ${fw.envFile}`))
    p.log.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }

  // ── Step 5: install @spanlens/sdk ─────────────────────────────────
  const pm = detectPackageManager(process.cwd())
  if (isAlreadyInstalled(process.cwd(), '@spanlens/sdk')) {
    p.log.success('@spanlens/sdk already in dependencies')
  } else {
    const shouldInstall = await p.confirm({
      message: `Install @spanlens/sdk now via ${pc.cyan(pm)}?`,
      initialValue: true,
    })
    if (p.isCancel(shouldInstall)) {
      p.cancel('Aborted.')
      process.exit(0)
    }
    if (shouldInstall) {
      const sInstall = p.spinner()
      sInstall.start(`Installing @spanlens/sdk with ${pm}`)
      const result = await installPackage(process.cwd(), pm, '@spanlens/sdk', {
        dryRun: flags.dryRun,
        silent: true,
      })
      if (result.ok) {
        sInstall.stop(
          flags.dryRun
            ? `[dry-run] would run: ${pc.cyan(result.command)}`
            : `Installed @spanlens/sdk (${result.command})`,
        )
      } else {
        sInstall.stop(pc.yellow(`Auto-install failed — install manually:`))
        p.log.message(`  ${pc.cyan(result.command)}`)
        if (result.error) p.log.message(pc.dim(`  (${result.error})`))
      }
    } else {
      p.log.warn("Skipped SDK install — you'll need to run it manually before deploying.")
    }
  }

  // ── Step 6 + 7: scan, patch, verify (rolls back on new type errors) ─
  const status = await runPatchStep({
    cwd: process.cwd(),
    providers: keyInfo.providers,
    dryRun: flags.dryRun,
    typecheck: fw.typescript && existsSync(resolve(process.cwd(), 'tsconfig.json')),
  })
  const outcome = finalOutcome(status)

  // ── Step 8: next steps ────────────────────────────────────────────
  if (outcome.showNextSteps) {
    p.note(
      buildNextSteps(
        { serverOrigin: flags.serverUrl, dashboardUrl, providers: keyInfo.providers },
        pc,
      ).join('\n'),
      'Next steps',
    )
  }

  if (outcome.showCta) {
    // ── Step 9: welcome message — PLG Loop ④ ───────────────────────
    // Subtle GitHub Star CTA after a successful init. Stars are evaluator-
    // first social proof for OSS projects; every init is one chance to ask.
    // Single strong CTA + one quiet secondary link — anything more dilutes.
    // utm_source distinguishes init traffic from other channels in GH analytics.
    p.log.message('')
    p.log.message(
      `${pc.yellow('★')}  Star Spanlens on GitHub:  ${pc.underline('https://github.com/spanlens/Spanlens?utm_source=cli_init')}`,
    )
    p.log.message(
      pc.dim(`   Read the docs:           https://spanlens.io/docs`),
    )
  }

  const paint = outcome.tone === 'success' ? pc.green : outcome.tone === 'warning' ? pc.yellow : pc.red
  p.outro(paint(outcome.message))
  process.exitCode = outcome.exitCode
}

main().catch((err) => {
  console.error(pc.red('[spanlens] Unexpected error:'), err)
  process.exit(1)
})
