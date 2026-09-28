/**
 * `client.evals.run({ timeoutMs })` is a CI gate, so the deadline must hold
 * no matter where the server stalls (C17.4). It used to be checked only
 * between polls: a POST, a GET, or a response body that never completed kept
 * run() waiting until the runtime's own fetch timeout (about 5 minutes in
 * Node) and then failed with a generic "fetch failed", and a long poll
 * interval slept straight past the deadline.
 *
 * The fetch stub honours `init.signal` exactly like real fetch: aborting
 * rejects a pending request and errors a response body that is still open.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { SpanlensClient } from '../client.js'
import type { EvalRun } from '../evals.js'

function pendingRun(): EvalRun {
  return {
    id: 'run_1',
    organization_id: 'org_1',
    evaluator_id: 'ev_1',
    prompt_version_id: 'pv_1',
    dataset_id: null,
    source: 'production',
    sample_size: 50,
    status: 'pending',
    scored_count: 0,
    attempted_count: 0,
    failed_count: 0,
    avg_score: null,
    score_stddev: null,
    total_cost_usd: 0,
    error: null,
    started_at: '2026-09-28T00:00:00Z',
    completed_at: null,
  }
}

function abortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError')
}

type Behaviour = 'pending-run' | 'stall' | 'stall-body'

/** Route POST and GET to a behaviour; everything honours the abort signal. */
function stubServer(post: Behaviour, get: Behaviour) {
  const fetchMock = vi.fn((_url: string, init: RequestInit) => {
    const behaviour = init.method === 'POST' ? post : get
    const signal = init.signal
    if (behaviour === 'pending-run') {
      return Promise.resolve(
        new Response(JSON.stringify({ success: true, data: pendingRun() }), { status: 200 }),
      )
    }
    if (behaviour === 'stall-body') {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"success":true,'))
          signal?.addEventListener('abort', () => controller.error(abortError()))
        },
      })
      return Promise.resolve(new Response(body, { status: 200 }))
    }
    return new Promise<Response>((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(abortError()))
    })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function makeClient() {
  return new SpanlensClient({ apiKey: 'sl_live_full', baseUrl: 'https://api.test' })
}

const INPUT = { evaluatorId: 'ev_1', promptVersionId: 'pv_1' }

async function elapsedRejection(promise: Promise<unknown>): Promise<{ ms: number; error: Error }> {
  const t0 = Date.now()
  try {
    await promise
  } catch (err) {
    return { ms: Date.now() - t0, error: err as Error }
  }
  throw new Error('expected the eval run to reject')
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('evals.run() enforces timeoutMs end to end', () => {
  it('when the trigger POST never answers', async () => {
    stubServer('stall', 'pending-run')
    const { ms, error } = await elapsedRejection(
      makeClient().evals.run(INPUT, { timeoutMs: 100 }),
    )
    expect(ms).toBeLessThan(1000)
    expect(error.message).toMatch(/did not finish within 100ms/)
  })

  it('when the trigger POST never answers even with wait: false', async () => {
    stubServer('stall', 'pending-run')
    const { ms, error } = await elapsedRejection(
      makeClient().evals.run(INPUT, { wait: false, timeoutMs: 100 }),
    )
    expect(ms).toBeLessThan(1000)
    expect(error.message).toMatch(/did not finish within 100ms/)
  })

  it('when a poll GET never answers', async () => {
    stubServer('pending-run', 'stall')
    const { ms, error } = await elapsedRejection(
      makeClient().evals.run(INPUT, { pollIntervalMs: 1, timeoutMs: 150 }),
    )
    expect(ms).toBeLessThan(1000)
    expect(error.message).toMatch(/eval run run_1 did not finish within 150ms/)
  })

  it('when a poll response body stalls after the headers', async () => {
    stubServer('pending-run', 'stall-body')
    const { ms, error } = await elapsedRejection(
      makeClient().evals.run(INPUT, { pollIntervalMs: 1, timeoutMs: 150 }),
    )
    expect(ms).toBeLessThan(1000)
    expect(error.message).toMatch(/did not finish within 150ms/)
  })

  it('when the poll interval is longer than the time left', async () => {
    const fetchMock = stubServer('pending-run', 'pending-run')
    const { ms, error } = await elapsedRejection(
      makeClient().evals.run(INPUT, { pollIntervalMs: 10_000, timeoutMs: 100 }),
    )
    expect(ms).toBeLessThan(1000)
    expect(error.message).toMatch(/eval run run_1 did not finish within 100ms \(last status: pending\)/)
    // The trigger went out; no poll could fit inside the deadline.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
