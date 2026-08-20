import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, test } from 'vitest'

/**
 * Source guard: every cron route that scans the `requests` log keeps its
 * cadence guard, and every job that reads that log checks the activity
 * watermark first.
 *
 * Same shape as api-v1-mount-order.test.ts: the property being protected
 * lives in how the router is assembled, not in a function's return value,
 * so the cheapest honest check is to read the source.
 *
 * Why it matters: three schedulers fire each of these handlers (vercel.json,
 * the GitHub Actions safety net, Better Stack monitors, gotcha #32), so
 * without the debounce a single nominal run is three full scans. The
 * watermark gate is the same argument one level down: an org, or the whole
 * platform, that logged nothing since the last run cannot have changed the
 * answer, so the scan is skipped rather than repeated.
 *
 * Dropping either guard is silent. The jobs keep returning correct answers,
 * they just pay several times over for them, on a table that grows with
 * traffic, and no behavioural test would notice. Hence this one.
 *
 * If a future change gates a job some other way, delete its entry from the
 * list below rather than loosening the assertion. The list is meant to be
 * the audited set.
 */

const REQUESTS_READING_CRONS = [
  'aggregate-usage',
  'check-quota-warnings',
  'detect-missing-model-prices',
] as const

/**
 * evaluate-alerts is deliberately absent from that list. It runs at its full
 * every-15-minutes cadence and relies on the activity watermark instead, so
 * a quiet window costs one indexed lookup and nothing more. Its own guard is
 * asserted separately below.
 */
const WATERMARK_GATED_JOB_SOURCES = [
  ['lib/cron-jobs/evaluate-alerts.ts', 'orgActiveSince'],
  ['lib/quota-warnings.ts', 'orgActiveSince'],
  ['lib/cron-jobs/aggregate-usage.ts', 'anyActivitySince'],
  ['lib/cron-jobs/detect-missing-model-prices.ts', 'anyActivitySince'],
  ['lib/data-silence.ts', 'shouldScanRequests'],
  ['lib/anomaly-snapshot.ts', 'getOrgActivitySince'],
  ['lib/recommendation-notify.ts', 'getOrgActivitySince'],
] as const

const cronSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'api', 'cron.ts'),
  'utf8',
)

describe('requests-scanning cron routes', () => {
  test.each(REQUESTS_READING_CRONS)('%s is debounced before the job body runs', (job) => {
    const routeStart = cronSource.indexOf(`cronRouter.get('/${job}'`)
    expect(routeStart, `route /${job} not found`).toBeGreaterThan(-1)

    const nextRoute = cronSource.indexOf('cronRouter.get(', routeStart + 1)
    const body = cronSource.slice(routeStart, nextRoute === -1 ? undefined : nextRoute)

    expect(body).toContain(`ranSuccessfullyWithin('${job}', SCAN_CRON_MIN_INTERVAL_MINUTES)`)
    expect(body).toContain(`cadenceSkipResponse('${job}', SCAN_CRON_MIN_INTERVAL_MINUTES)`)

    // The guard has to short-circuit ahead of the work, otherwise it costs
    // the scan it exists to prevent.
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

describe('watermark-gated requests jobs', () => {
  test.each(WATERMARK_GATED_JOB_SOURCES)(
    '%s checks the activity watermark before scanning requests',
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
