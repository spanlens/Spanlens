#!/usr/bin/env node
/**
 * @spanlens/cli — onboarding wizard.
 *
 *   npx @spanlens/cli init
 *   npx @spanlens/cli init --dry-run
 *
 * MVP scope: Next.js project, OpenAI integration. Walks the user through:
 *   1. Confirming they have a Spanlens account + API key + provider key registered
 *   2. Writing SPANLENS_API_KEY into .env.local
 *   3. Rewriting `new OpenAI(...)` → `createOpenAI()` across their source
 *   4. Printing next steps (Vercel env, redeploy)
 */

import * as p from '@clack/prompts'
import pc from 'picocolors'
import { detectFramework } from './framework-detect.js'
import { upsertEnvVar } from './env-writer.js'
import { planPatches, applyPatches, type PatchPlan } from './code-patcher.js'

const DASHBOARD_URL = 'https://www.spanlens.io'

interface Flags {
  dryRun: boolean
  subcommand: string
}

function parseFlags(argv: readonly string[]): Flags {
  const args = argv.slice(2)
  return {
    subcommand: args[0] ?? 'init',
    dryRun: args.includes('--dry-run'),
  }
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

  // Step 1: framework detection
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

  // Step 2: prerequisites reminder
  p.log.message('')
  p.log.step(pc.bold('Before continuing, make sure you have:'))
  p.log.message(`  1. A Spanlens account — ${pc.underline(DASHBOARD_URL)}`)
  p.log.message(`  2. A Project + API key created in ${pc.underline(DASHBOARD_URL + '/projects')}`)
  p.log.message(`  3. Provider keys (OpenAI, etc.) registered in ${pc.underline(DASHBOARD_URL + '/settings')}`)
  p.log.message('')

  const ready = await p.confirm({
    message: 'Ready? (If not, visit the dashboard first — everything else is automated)',
    initialValue: true,
  })
  if (p.isCancel(ready) || !ready) {
    p.cancel('Aborted. Come back after setting up the dashboard.')
    process.exit(0)
  }

  // Step 3: collect Spanlens API key
  const apiKey = await p.password({
    message: 'Paste your Spanlens API key (starts with sl_live_)',
    validate: (v) => {
      if (!v || v.length < 20) return 'Looks too short'
      if (!v.startsWith('sl_live_') && !v.startsWith('sl_test_')) {
        return 'Spanlens API keys start with sl_live_ or sl_test_'
      }
      return undefined
    },
  })
  if (p.isCancel(apiKey)) {
    p.cancel('Aborted.')
    process.exit(0)
  }

  // Step 4: write .env file
  const s1 = p.spinner()
  s1.start(`Updating ${fw.envFile}`)
  let envResult: ReturnType<typeof upsertEnvVar>
  try {
    if (flags.dryRun) {
      envResult = { changed: true, created: false, existed: true }
      s1.stop(`[dry-run] would write SPANLENS_API_KEY to ${fw.envFile}`)
    } else {
      envResult = upsertEnvVar(process.cwd(), fw.envFile, 'SPANLENS_API_KEY', apiKey)
      if (envResult.created) {
        s1.stop(`Created ${fw.envFile} with SPANLENS_API_KEY`)
      } else if (envResult.changed) {
        s1.stop(`Updated SPANLENS_API_KEY in ${fw.envFile}`)
      } else {
        s1.stop(`SPANLENS_API_KEY already up to date in ${fw.envFile}`)
      }
    }
  } catch (err) {
    s1.stop(pc.red(`Failed to write ${fw.envFile}`))
    p.log.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }

  // Step 5: scan for OpenAI client usage
  const s2 = p.spinner()
  s2.start('Scanning codebase for `new OpenAI(...)`')
  let plans: PatchPlan[] = []
  try {
    plans = await planPatches(process.cwd())
  } catch (err) {
    s2.stop(pc.red('Scan failed'))
    p.log.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }
  s2.stop(`Found ${plans.length} file${plans.length === 1 ? '' : 's'} to patch`)

  if (plans.length === 0) {
    p.log.message(
      pc.dim(
        'No `new OpenAI(...)` call found. If you use OpenAI, add this import manually:\n' +
        "  import { createOpenAI } from '@spanlens/sdk/openai'\n" +
        "  const openai = createOpenAI()",
      ),
    )
  } else {
    for (const plan of plans) {
      p.log.message(`  ${pc.cyan('•')} ${pc.dim(plan.filepath)}`)
      for (const change of plan.changes) {
        p.log.message(`      ${pc.dim('→')} ${change}`)
      }
    }

    const approve = await p.confirm({
      message: flags.dryRun
        ? 'Dry run: show patch preview (nothing will be written)?'
        : 'Apply these changes?',
      initialValue: true,
    })
    if (p.isCancel(approve) || !approve) {
      p.log.warn('Code patch skipped. You can run the wizard again anytime.')
    } else {
      const s3 = p.spinner()
      s3.start(flags.dryRun ? 'Dry-run patch' : 'Patching files')
      try {
        const results = await applyPatches(plans, { dryRun: flags.dryRun })
        const patched = results.filter((r) => r.patched).length
        s3.stop(
          flags.dryRun
            ? `[dry-run] would patch ${patched} file${patched === 1 ? '' : 's'}`
            : `Patched ${patched} file${patched === 1 ? '' : 's'}`,
        )
      } catch (err) {
        s3.stop(pc.red('Patch failed'))
        p.log.error(err instanceof Error ? err.message : String(err))
      }
    }
  }

  // Step 6: next steps
  p.note(
    [
      `${pc.bold('1.')} Install the SDK (if not already):`,
      `     ${pc.cyan('npm install @spanlens/sdk')}`,
      '',
      `${pc.bold('2.')} Add ${pc.cyan('SPANLENS_API_KEY')} to your deployment environment`,
      `     ${pc.dim('(Vercel/Railway/Fly → Settings → Environment Variables)')}`,
      '',
      `${pc.bold('3.')} Redeploy your app`,
      '',
      `${pc.bold('4.')} Your requests will show up at:`,
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
