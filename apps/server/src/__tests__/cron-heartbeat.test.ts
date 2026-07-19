/**
 * pingHeartbeat — external cron heartbeat signal (lib/cron-heartbeat.ts).
 *
 * Contract under test:
 *   1. Env key derivation: job name `-` → `_`, uppercased, HEARTBEAT_ prefix.
 *   2. Unset env → no fetch at all (opt-in per job).
 *   3. fetch rejection → resolves anyway (a heartbeat must never break a cron).
 *   4. fetch timeout signal is passed (pinger outage cannot hang the job).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { pingHeartbeat } from '../lib/cron-heartbeat.js'

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  fetchMock.mockResolvedValue(new Response('ok'))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('pingHeartbeat', () => {
  test('derives HEARTBEAT_<JOB> env key from kebab-case job name', async () => {
    vi.stubEnv('HEARTBEAT_REPLAY_FALLBACK', 'https://uptime.betterstack.com/api/v1/heartbeat/abc123')

    await pingHeartbeat('replay-fallback')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://uptime.betterstack.com/api/v1/heartbeat/abc123',
      expect.objectContaining({ method: 'GET', signal: expect.any(AbortSignal) }),
    )
  })

  test('no env configured → no network call (opt-in)', async () => {
    await pingHeartbeat('evaluate-alerts')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('fetch rejection never propagates', async () => {
    vi.stubEnv('HEARTBEAT_SELF_MONITOR', 'https://uptime.betterstack.com/api/v1/heartbeat/dead')
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'))

    await expect(pingHeartbeat('self-monitor')).resolves.toBeUndefined()
  })

  test('multi-hyphen job name maps every segment', async () => {
    vi.stubEnv('HEARTBEAT_EXECUTE_PENDING_DELETIONS', 'https://example.com/hb')

    await pingHeartbeat('execute-pending-deletions')

    expect(fetchMock).toHaveBeenCalledWith('https://example.com/hb', expect.anything())
  })
})
