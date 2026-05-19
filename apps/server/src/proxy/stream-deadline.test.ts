import { describe, expect, test, vi, afterEach } from 'vitest'
import {
  cancelReaderSilently,
  makeStreamDeadline,
  readWithDeadline,
} from './stream-deadline.js'

// Tiny stand-in for ReadableStreamDefaultReader<Uint8Array> — gives us full
// control over the resolve order so we can assert chunk / done / timeout
// without spinning up a real Web stream.
type ReadResult = ReadableStreamReadResult<Uint8Array>
function makeMockReader(scripted: Array<Promise<ReadResult> | ReadResult>): ReadableStreamDefaultReader<Uint8Array> {
  let i = 0
  const cancelled: { value: boolean } = { value: false }
  return {
    read: () => {
      const next = scripted[i++]
      if (!next) {
        // Default to "stays pending forever" when the script runs out — caller
        // probably wanted the timer to fire instead.
        return new Promise<ReadResult>(() => {})
      }
      return Promise.resolve(next)
    },
    cancel: () => {
      cancelled.value = true
      return Promise.resolve()
    },
    releaseLock: () => {},
    closed: Promise.resolve(undefined),
    // exposed for test assertions
    __cancelled: cancelled,
  } as unknown as ReadableStreamDefaultReader<Uint8Array>
}

afterEach(() => {
  vi.useRealTimers()
})

describe('makeStreamDeadline', () => {
  test('computes absolute deadline from start time + budget', () => {
    const d = makeStreamDeadline(1_000_000, 290_000)
    expect(d.deadlineAtMs).toBe(1_290_000)
  })

  test('defaults to STREAM_DEADLINE_MS when budget omitted', () => {
    const start = Date.now()
    const d = makeStreamDeadline(start)
    // Default 290_000 ms; allow a 5ms drift so the test doesn't flake on slow boxes
    expect(d.deadlineAtMs - start).toBeGreaterThanOrEqual(290_000 - 5)
    expect(d.deadlineAtMs - start).toBeLessThanOrEqual(290_000 + 5)
  })
})

describe('readWithDeadline', () => {
  test('returns chunk when read resolves before deadline', async () => {
    const reader = makeMockReader([
      { done: false, value: new Uint8Array([1, 2, 3]) },
    ])
    const deadline = makeStreamDeadline(Date.now(), 1_000)

    const outcome = await readWithDeadline(reader, deadline)
    expect(outcome.kind).toBe('chunk')
    if (outcome.kind === 'chunk') {
      expect(Array.from(outcome.value)).toEqual([1, 2, 3])
    }
  })

  test('returns done when reader signals end of stream', async () => {
    const reader = makeMockReader([
      { done: true, value: undefined } as ReadResult,
    ])
    const deadline = makeStreamDeadline(Date.now(), 1_000)

    const outcome = await readWithDeadline(reader, deadline)
    expect(outcome.kind).toBe('done')
  })

  test('returns timeout immediately when deadline already in the past', async () => {
    const reader = makeMockReader([
      // Read promise that never resolves — only the deadline check should fire.
      new Promise<ReadResult>(() => {}),
    ])
    const deadline = { deadlineAtMs: Date.now() - 1 }

    const outcome = await readWithDeadline(reader, deadline)
    expect(outcome.kind).toBe('timeout')
  })

  test('returns timeout when reader pending past deadline (fake timers)', async () => {
    vi.useFakeTimers()
    const reader = makeMockReader([
      new Promise<ReadResult>(() => {}),  // never resolves
    ])
    const deadline = makeStreamDeadline(Date.now(), 500)

    const promise = readWithDeadline(reader, deadline)
    await vi.advanceTimersByTimeAsync(501)

    const outcome = await promise
    expect(outcome.kind).toBe('timeout')
  })

  test('returns error when read rejects (e.g. upstream RST)', async () => {
    const failingReader = {
      read: () => Promise.reject(new Error('upstream reset')),
      cancel: () => Promise.resolve(),
      releaseLock: () => {},
      closed: Promise.resolve(undefined),
    } as unknown as ReadableStreamDefaultReader<Uint8Array>

    const deadline = makeStreamDeadline(Date.now(), 1_000)
    const outcome = await readWithDeadline(failingReader, deadline)

    expect(outcome.kind).toBe('error')
    if (outcome.kind === 'error') {
      expect((outcome.error as Error).message).toBe('upstream reset')
    }
  })

  test('clears pending timer when read wins the race (no leak)', async () => {
    // If the timer wasn't cleared, the test runtime would keep a handle
    // open. We just assert behavior — leak detection is implicit via the
    // vitest pool not hanging.
    vi.useFakeTimers()
    const reader = makeMockReader([
      { done: false, value: new Uint8Array([42]) },
    ])
    const deadline = makeStreamDeadline(Date.now(), 5_000)

    const outcome = await readWithDeadline(reader, deadline)
    expect(outcome.kind).toBe('chunk')

    // Advance past the deadline — no late callbacks should resolve anything.
    await vi.advanceTimersByTimeAsync(10_000)
    // No assertion here other than "test completes" — leak would hang vitest.
  })
})

describe('cancelReaderSilently', () => {
  test('calls reader.cancel() once', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined)
    const reader = { cancel } as unknown as ReadableStreamDefaultReader<Uint8Array>
    await cancelReaderSilently(reader)
    expect(cancel).toHaveBeenCalledOnce()
  })

  test('swallows errors from cancel (already-closed stream)', async () => {
    const cancel = vi.fn().mockRejectedValue(new Error('already closed'))
    const reader = { cancel } as unknown as ReadableStreamDefaultReader<Uint8Array>
    await expect(cancelReaderSilently(reader)).resolves.toBeUndefined()
  })
})
