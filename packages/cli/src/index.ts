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
 *   6. Running `tsc --noEmit` to verify the patch didn't break the build
 */

import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as p from '@clack/prompts'
import pc from 'picocolors'
import { detectFramework } from './framework-detect.js'
import { upsertEnvVar } from './env-writer.js'
import { planPatches, applyPatches, type PatchPlan, type Provider } from './code-patcher.js'
import {
  detectPackageManager,
  isAlreadyInstalled,
  installPackage,
} from './installer.js'

const DASHBOARD_URL = 'https://www.spanlens.io'
const API_BASE = process.env.SPANLENS_API_BASE ?? 'https://www.spanlens.io'

interface Flags {
  dryRun: boolean
  subcommand: string
}

interface KeyInfo {
  projectId: string
  projectName: string
  providers: Provider[]
}

function parseFlags(argv: readonly string[]): Flags {
  const args = argv.slice(2)
  return {
    subcommand: args[0] ?? 'init',
    dryRun: args.includes('--dry-run'),
  }
}

/** Hit /api/v1/me/key-info with the user's Spanlens key. */
async function fetchKeyInfo(apiKey: string): Promise<KeyInfo> {
  const url = `${API_BASE}/api/v1/me/key-info`
  let res: Response
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
  } catch (err) {
    throw new Error(
      `Network error contacting ${API_BASE}. Check your connection. (${err instanceof Error ? err.message : String(err)})`,
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
    p.log.message('Usage:  npx @spanlens/cli init [--dry-run]')
    process.exit(1)
  }

  p.intro(pc.cyan('🔭  Spanlens setup'))

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
  p.log.message(`  1. A Spanlens account — ${pc.underline(DASHBOARD_URL)}`)
  p.log.message(`  2. A Project at ${pc.underline(DASHBOARD_URL + '/projects')}`)
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
  let keyInfo: KeyInfo
  try {
    keyInfo = await fetchKeyInfo(apiKey)
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
      `  Add provider keys at ${pc.underline(`${DASHBOARD_URL}/projects`)} → your project → "Add provider key"`,
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
      sEnv.stop(`[dry-run] would write SPANLENS_API_KEY to ${fw.envFile}`)
    } else {
      const r = upsertEnvVar(process.cwd(), fw.envFile, 'SPANLENS_API_KEY', apiKey)
      if (r.created) sEnv.stop(`Created ${fw.envFile} with SPANLENS_API_KEY`)
      else if (r.changed) sEnv.stop(`Updated SPANLENS_API_KEY in ${fw.envFile}`)
      else sEnv.stop(`SPANLENS_API_KEY already up to date in ${fw.envFile}`)
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

  // ── Step 6: scan + patch each registered provider ─────────────────
  const sScan = p.spinner()
  sScan.start(
    `Scanning codebase for ${
      keyInfo.providers.length > 0 ? keyInfo.providers.map((p) => `\`${p}\``).join(', ') : 'provider'
    } usage`,
  )
  let plans: PatchPlan[] = []
  try {
    plans = await planPatches(process.cwd(), keyInfo.providers)
  } catch (err) {
    sScan.stop(pc.red('Scan failed'))
    p.log.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }
  sScan.stop(`Found ${plans.length} patch${plans.length === 1 ? '' : 'es'} to apply`)

  if (plans.length === 0) {
    if (keyInfo.providers.length === 0) {
      p.log.message(
        pc.dim('No providers registered yet — nothing to patch. Add provider keys + re-run.'),
      )
    } else {
      const importLines = keyInfo.providers
        .map(
          (p) =>
            `  ${pc.dim('import { create' + p[0]!.toUpperCase() + p.slice(1) + ' } from "@spanlens/sdk/' + p + '"')}`,
        )
        .join('\n')
      p.log.message(
        pc.dim(
          `No matching client constructors found. Add manually:\n${importLines}`,
        ),
      )
    }
  } else {
    for (const plan of plans) {
      p.log.message(`  ${pc.cyan('•')} [${plan.provider}] ${pc.dim(plan.filepath)}`)
      for (const change of plan.changes) {
        p.log.message(`      ${pc.dim('→')} ${change}`)
      }
    }

    const approve = await p.confirm({
      message: flags.dryRun ? 'Dry run: show patch preview?' : 'Apply these changes?',
      initialValue: true,
    })
    if (p.isCancel(approve) || !approve) {
      p.log.warn('Code patch skipped. You can re-run the wizard anytime.')
    } else {
      const sPatch = p.spinner()
      sPatch.start(flags.dryRun ? 'Dry-run patch' : 'Patching files')
      try {
        const results = await applyPatches(plans, { dryRun: flags.dryRun })
        const patched = results.filter((r) => r.patched).length
        sPatch.stop(
          flags.dryRun
            ? `[dry-run] would patch ${patched} file${patched === 1 ? '' : 's'}`
            : `Patched ${patched} file${patched === 1 ? '' : 's'}`,
        )
      } catch (err) {
        sPatch.stop(pc.red('Patch failed'))
        p.log.error(err instanceof Error ? err.message : String(err))
      }
    }

    // ── Step 7: typecheck verification (only when files actually written) ─
    if (!flags.dryRun && fw.typescript && existsSync(resolve(process.cwd(), 'tsconfig.json'))) {
      const sTc = p.spinner()
      sTc.start('Verifying patch with TypeScript')
      try {
        execSync('npx --no-install tsc --noEmit', {
          cwd: process.cwd(),
          stdio: 'pipe',
          timeout: 60_000,
        })
        sTc.stop('TypeScript check passed ✓')
      } catch (err) {
        sTc.stop(pc.yellow('TypeScript reported errors after patch — review manually'))
        const stderr = (err as { stderr?: Buffer; stdout?: Buffer }).stderr ?? (err as { stdout?: Buffer }).stdout
        const text = stderr ? stderr.toString().trim() : ''
        if (text) {
          // Show only the first ~10 lines to avoid flooding terminal
          const lines = text.split('\n').slice(0, 10)
          for (const line of lines) p.log.message(pc.dim(`  ${line}`))
          if (text.split('\n').length > 10) p.log.message(pc.dim(`  …`))
        }
      }
    }
  }

  // ── Step 8: next steps ────────────────────────────────────────────
  p.note(
    [
      `${pc.bold('1.')} Add ${pc.cyan('SPANLENS_API_KEY')} to your deployment environment`,
      `     ${pc.dim('(Vercel/Railway/Fly → Settings → Environment Variables)')}`,
      '',
      `${pc.bold('2.')} Redeploy your app`,
      '',
      `${pc.bold('3.')} Your requests will show up at:`,
      `     ${pc.underline(DASHBOARD_URL + '/requests')}`,
    ].join('\n'),
    'Next steps',
  )

  p.outro(pc.green('🎉 Spanlens setup complete'))
}

main().catch((err) => {
  console.error(pc.red('[spanlens] Unexpected error:'), err)
  process.exit(1)
})
