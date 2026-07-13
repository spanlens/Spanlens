import { beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * cron-logger contract tests (2026-07-13 audit — cron run logging drain).
 *
 * Two guarantees callers rely on:
 *
 *   1. `logCronRun` never throws. Handlers `await` it directly (so the
 *      `cron_job_runs` row is drained before the response returns —
 *      CLAUDE.md gotcha #8); if a Supabase blip could reject, awaiting
 *      would flip a successful cron run into a 500.
 *
 *   2. `withCronLog` awaits the log write before resolving. The old
 *      implementation fired `logCronRun(...).catch(...)` without awaiting,
 *      which Vercel drops after the handler returns → row lost → the
 *      cron-health monitoring (gotcha #32) misreads "cron never fired".
 */

const insertMock = vi.fn()

vi.mock('../lib/db.js', () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      insert: (payload: unknown) => insertMock(table, payload),
    }),
  },
}))

import { logCronRun, withCronLog } from '../lib/cron-logger.js'

beforeEach(() => {
  insertMock.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('logCronRun', () => {
  test('inserts one row into cron_job_runs with rounded duration', async () => {
    insertMock.mockResolvedValue({ error: null })

    await logCronRun('test-job', 'ok', 123.6)

    expect(insertMock).toHaveBeenCalledTimes(1)
    expect(insertMock).toHaveBeenCalledWith('cron_job_runs', {
      job_name: 'test-job',
      status: 'ok',
      duration_ms: 124,
      error_message: null,
    })
  })

  test('passes errorMessage through for error runs', async () => {
    insertMock.mockResolvedValue({ error: null })

    await logCronRun('test-job', 'error', 10, 'boom')

    expect(insertMock).toHaveBeenCalledWith(
      'cron_job_runs',
      expect.objectContaining({ status: 'error', error_message: 'boom' }),
    )
  })

  test('never throws when the insert rejects (network failure)', async () => {
    insertMock.mockRejectedValue(new Error('network down'))

    await expect(logCronRun('test-job', 'ok', 10)).resolves.toBeUndefined()
    expect(console.error).toHaveBeenCalled()
  })

  test('never throws when supabase returns an error envelope', async () => {
    insertMock.mockResolvedValue({ error: { message: 'permission denied' } })

    await expect(logCronRun('test-job', 'ok', 10)).resolves.toBeUndefined()
    expect(console.error).toHaveBeenCalled()
  })
})

describe('withCronLog', () => {
  test('log write completes before withCronLog resolves (Vercel drain guarantee)', async () => {
    let logWritten = false
    insertMock.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
      logWritten = true
      return { error: null }
    })

    const result = await withCronLog('test-job', async () => 'done')

    expect(result).toBe('done')
    expect(logWritten).toBe(true)
  })

  test('logs error status and returns null when fn throws', async () => {
    insertMock.mockResolvedValue({ error: null })

    const result = await withCronLog('test-job', async () => {
      throw new Error('job failed')
    })

    expect(result).toBeNull()
    expect(insertMock).toHaveBeenCalledWith(
      'cron_job_runs',
      expect.objectContaining({
        job_name: 'test-job',
        status: 'error',
        error_message: 'job failed',
      }),
    )
  })
})
