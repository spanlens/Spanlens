import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, test } from 'vitest'

/**
 * Source guard: every ClickHouse-reading cron route keeps its cadence guard.
 *
 * Same shape as api-v1-mount-order.test.ts — the property being protected
 * lives in how the router is assembled, not in a function's return value,
 * so the cheapest honest check is to read the source.
 *
 * Why it matters: these four handlers are the only cron routes that query
 * ClickHouse. Three schedulers fire each of them (vercel.json, the GitHub
 * Actions safety net, Better Stack monitors — gotcha #32), and ClickHouse
 * Cloud only suspends after 15 quiet minutes, so without the guard the
 * duplicate firings kept a service handling ~8 requests/day billed as
 * running 24/7 ($8.80/day, measured 2026-08-18). Dropping the guard from
 * any one of them silently restores that bill, and no behavioural test
 * would fail. Hence this one.
 *
 * If a future change gates ClickHouse access some other way (the Postgres
 * activity watermark), delete the entry from CH_READING_CRONS rather than
 * loosening the assertion — the list is meant to be the audited set.
 */

const CH_READING_CRONS = [
  'aggregate-usage',
  'check-quota-warnings',
  'detect-missing-model-prices',
] as const

/**
 * evaluate-alerts is deliberately absent from that list. It runs at its full
 * every-15-minutes cadence and relies on the activity watermark instead, so
 * a quiet window costs a Postgres query and nothing more. Its own guard is
 * asserted separately below.
 */
const WATERMARK_GATED_JOB_SOURCES = [
  ['lib/cron-jobs/evaluate-alerts.ts', 'orgActiveSince'],
  ['lib/quota-warnings.ts', 'orgActiveSince'],
  ['lib/cron-jobs/aggregate-usage.ts', 'anyActivitySince'],
  ['lib/cron-jobs/detect-missing-model-prices.ts', 'anyActivitySince'],
] as const

const cronSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'api', 'cron.ts'),
  'utf8',
)

describe('ClickHouse-reading cron routes', () => {
  test.each(CH_READING_CRONS)('%s is debounced before the job body runs', (job) => {
    const routeStart = cronSource.indexOf(`cronRouter.get('/${job}'`)
    expect(routeStart, `route /${job} not found`).toBeGreaterThan(-1)

    const nextRoute = cronSource.indexOf('cronRouter.get(', routeStart + 1)
    const body = cronSource.slice(routeStart, nextRoute === -1 ? undefined : nextRoute)

    expect(body).toContain(`ranSuccessfullyWithin('${job}', CH_CRON_MIN_INTERVAL_MINUTES)`)
    expect(body).toContain(`cadenceSkipResponse('${job}', CH_CRON_MIN_INTERVAL_MINUTES)`)

    // The guard has to short-circuit ahead of the work, otherwise it costs
    // the ClickHouse wake-up it exists to prevent.
    const guardAt = body.indexOf('ranSuccessfullyWithin')
    const logAt = body.indexOf('logCronRun')
    expect(guardAt).toBeLessThan(logAt)
  })

  test('the guard helpers are imported from lib/cron-cadence', () => {
    expect(cronSource).toContain("from '../lib/cron-cadence.js'")
  })

  test('evaluate-alerts keeps its full cadence and is not debounced', () => {
    const routeStart = cronSource.indexOf("cronRouter.get('/evaluate-alerts'")
    const nextRoute = cronSource.indexOf('cronRouter.get(', routeStart + 1)
    const body = cronSource.slice(routeStart, nextRoute === -1 ? undefined : nextRoute)
    expect(body).not.toContain('ranSuccessfullyWithin')
  })
})

describe('watermark-gated ClickHouse jobs', () => {
  test.each(WATERMARK_GATED_JOB_SOURCES)(
    '%s checks the activity watermark before querying ClickHouse',
    (relPath, guard) => {
      const src = readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), '..', ...relPath.split('/')),
        'utf8',
      )
      // Relative depth differs between lib/ and lib/cron-jobs/.
      expect(src).toMatch(/from '\.\.?\/(\.\.\/)?org-activity\.js'/)
      expect(src).toContain(guard)
    },
  )
})
