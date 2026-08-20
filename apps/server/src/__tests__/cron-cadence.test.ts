import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * cron-cadence tests.
 *
 * The guard exists to stop three schedulers (vercel.json, the GitHub
 * Actions safety net, Better Stack monitors) from each running the same
 * scan over `requests`. Two properties matter and both are covered:
 *
 *   1. A recent successful run debounces the next firing.
 *   2. Any failure to answer that question runs the job anyway
 *      (fail-open). Skipping real work on a Postgres hiccup is worse
 *      than one redundant scan.
 */

const queryMock = vi.fn()
let capturedFilters: Array<[string, unknown]> = []
let capturedTable = ''

vi.mock('../lib/db.js', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      capturedTable = table
      const chain = {
        select: () => chain,
        eq: (col: string, val: unknown) => {
          capturedFilters.push([col, val])
          return chain
        },
        gte: (col: string, val: unknown) => {
          capturedFilters.push([col, val])
          return chain
        },
        limit: () => queryMock(),
      }
      return chain
    },
  },
}))

let ranSuccessfullyWithin: typeof import('../lib/cron-cadence.js').ranSuccessfullyWithin
let cadenceSkipResponse: typeof import('../lib/cron-cadence.js').cadenceSkipResponse
let SCAN_CRON_MIN_INTERVAL_MINUTES: number

beforeEach(async () => {
  vi.resetModules()
  queryMock.mockReset()
  capturedFilters = []
  capturedTable = ''
  const mod = await import('../lib/cron-cadence.js')
  ranSuccessfullyWithin = mod.ranSuccessfullyWithin
  cadenceSkipResponse = mod.cadenceSkipResponse
  SCAN_CRON_MIN_INTERVAL_MINUTES = mod.SCAN_CRON_MIN_INTERVAL_MINUTES
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ranSuccessfullyWithin', () => {
  test('returns true when a successful run exists inside the window', async () => {
    queryMock.mockResolvedValue({ data: [{ ran_at: new Date().toISOString() }], error: null })
    await expect(ranSuccessfullyWithin('aggregate-usage', 55)).resolves.toBe(true)
  })

  test('returns false when no run exists inside the window', async () => {
    queryMock.mockResolvedValue({ data: [], error: null })
    await expect(ranSuccessfullyWithin('aggregate-usage', 55)).resolves.toBe(false)
  })

  test('treats a null data payload as no recent run', async () => {
    queryMock.mockResolvedValue({ data: null, error: null })
    await expect(ranSuccessfullyWithin('aggregate-usage', 55)).resolves.toBe(false)
  })

  test('fails open when the lookup returns an error', async () => {
    queryMock.mockResolvedValue({ data: null, error: { message: 'connection reset' } })
    await expect(ranSuccessfullyWithin('evaluate-alerts', 55)).resolves.toBe(false)
  })

  test('fails open when the lookup throws', async () => {
    queryMock.mockRejectedValue(new Error('socket hang up'))
    await expect(ranSuccessfullyWithin('evaluate-alerts', 55)).resolves.toBe(false)
  })

  test('scopes the lookup to the job name, ok status, and the cutoff', async () => {
    queryMock.mockResolvedValue({ data: [], error: null })
    const before = Date.now()
    await ranSuccessfullyWithin('check-quota-warnings', 55)

    expect(capturedTable).toBe('cron_job_runs')
    expect(capturedFilters).toContainEqual(['job_name', 'check-quota-warnings'])
    expect(capturedFilters).toContainEqual(['status', 'ok'])

    const cutoffFilter = capturedFilters.find(([col]) => col === 'ran_at')
    expect(cutoffFilter).toBeDefined()
    const cutoffMs = Date.parse(cutoffFilter![1] as string)
    // 55 minutes back from "now", with slack for test execution time.
    expect(before - cutoffMs).toBeGreaterThanOrEqual(55 * 60 * 1000)
    expect(before - cutoffMs).toBeLessThan(56 * 60 * 1000)
  })
})

describe('cadenceSkipResponse', () => {
  test('reports success so the calling scheduler stays green', () => {
    const body = cadenceSkipResponse('aggregate-usage', SCAN_CRON_MIN_INTERVAL_MINUTES)
    expect(body).toEqual({
      success: true,
      skipped: 'cadence',
      job: 'aggregate-usage',
      min_interval_minutes: 55,
    })
  })
})
