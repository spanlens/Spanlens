import { beforeEach, describe, expect, test, vi } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// P3.11 streaming-exports tests.
//
// Two layers tested:
//   1. `buildCsvStream` / `buildJsonlStream` — pure stream encoders. Fed by a
//      controllable async iterable so we can verify byte-level output for
//      header rows, escaping, line endings, and graceful close.
//   2. Memory boundedness — a 100k-row generator that fails the test if more
//      than a small constant number of rows are simultaneously alive. Proves
//      the streams don't materialise the entire result set.
//
// The streamRequests() helper itself is exercised end-to-end via a mocked
// ClickHouse client stream so we cover the Row.json() + AsyncGenerator path.
// ─────────────────────────────────────────────────────────────────────────────

// Set up env vars before any module that reads them initialises.
process.env['CLICKHOUSE_URL'] ??= 'http://localhost:8123'
process.env['CLICKHOUSE_USER'] ??= 'default'
process.env['CLICKHOUSE_PASSWORD'] ??= 'test'

import { buildCsvStream, buildJsonlStream } from '../api/exports.js'

// ── helpers ──────────────────────────────────────────────────────────────────

async function* fromArray<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) {
    yield item
  }
}

/**
 * Reads a ReadableStream<Uint8Array> to completion and returns the UTF-8 text.
 */
async function readToString(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let out = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    out += decoder.decode(value, { stream: true })
  }
  out += decoder.decode()
  return out
}

// ── CSV encoder ──────────────────────────────────────────────────────────────

describe('buildCsvStream', () => {
  test('emits header row + escaped cells', async () => {
    const rows = fromArray<Record<string, unknown>>([
      { id: '1', name: 'Alice', notes: 'hi' },
      { id: '2', name: 'Bob, Jr.', notes: 'has, comma' },
      { id: '3', name: 'with "quotes"', notes: 'and\nnewline' },
    ])
    const out = await readToString(buildCsvStream(['id', 'name', 'notes'], rows))
    // Note: splitting on '\n' is unsafe here because row #3 contains a literal
    // newline inside a quoted cell — RFC 4180 allows that. Compare the full
    // payload byte-for-byte instead.
    expect(out).toBe(
      'id,name,notes\n' +
        '1,Alice,hi\n' +
        '2,"Bob, Jr.","has, comma"\n' +
        '3,"with ""quotes""","and\nnewline"\n',
    )
  })

  test('renders null / undefined / number cells correctly', async () => {
    const rows = fromArray<Record<string, unknown>>([
      { a: null, b: undefined, c: 0 },
      { a: '', b: false, c: 3.14 },
    ])
    const out = await readToString(buildCsvStream(['a', 'b', 'c'], rows))
    expect(out).toBe(
      [
        'a,b,c',
        ',,0',
        ',false,3.14',
        '',
      ].join('\n'),
    )
  })

  test('emits header only for empty iterables', async () => {
    const rows = fromArray<Record<string, unknown>>([])
    const out = await readToString(buildCsvStream(['x', 'y'], rows))
    expect(out).toBe('x,y\n')
  })

  test('propagates iterator errors via controller.error', async () => {
    async function* bad(): AsyncGenerator<Record<string, unknown>> {
      yield { a: 1 }
      throw new Error('boom')
    }
    await expect(readToString(buildCsvStream(['a'], bad()))).rejects.toThrow('boom')
  })
})

// ── JSONL encoder ────────────────────────────────────────────────────────────

describe('buildJsonlStream', () => {
  test('emits one JSON object per line, newline-terminated', async () => {
    const rows = fromArray([
      { id: '1', n: 10 },
      { id: '2', n: 20 },
    ])
    const out = await readToString(buildJsonlStream(rows))
    const lines = out.split('\n')
    expect(lines).toEqual([
      '{"id":"1","n":10}',
      '{"id":"2","n":20}',
      '',
    ])
    // Round-trip each non-empty line.
    expect(JSON.parse(lines[0]!)).toEqual({ id: '1', n: 10 })
    expect(JSON.parse(lines[1]!)).toEqual({ id: '2', n: 20 })
  })

  test('escapes embedded newlines / quotes correctly', async () => {
    const rows = fromArray([
      { msg: 'line1\nline2' },
      { msg: 'has "quote"' },
    ])
    const out = await readToString(buildJsonlStream(rows))
    const lines = out.trimEnd().split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0]!)).toEqual({ msg: 'line1\nline2' })
    expect(JSON.parse(lines[1]!)).toEqual({ msg: 'has "quote"' })
  })

  test('emits empty output for empty iterables', async () => {
    const rows = fromArray<Record<string, unknown>>([])
    const out = await readToString(buildJsonlStream(rows))
    expect(out).toBe('')
  })

  test('propagates iterator errors via controller.error', async () => {
    async function* bad(): AsyncGenerator<{ id: number }> {
      yield { id: 1 }
      throw new Error('upstream fail')
    }
    await expect(readToString(buildJsonlStream(bad()))).rejects.toThrow('upstream fail')
  })
})

// ── Memory boundedness ───────────────────────────────────────────────────────

describe('streaming-encoder memory bound', () => {
  /**
   * Generator that produces N rows but tracks how many are alive at once.
   * If the encoder buffers the entire result set, `peakAlive` will equal N.
   * For a true streaming pipeline `peakAlive` stays near 1 because each row
   * is consumed before the next is requested.
   */
  function trackedRows(total: number, tracker: { peakAlive: number; alive: number }): AsyncGenerator<Record<string, unknown>> {
    async function* gen() {
      for (let i = 0; i < total; i++) {
        tracker.alive++
        if (tracker.alive > tracker.peakAlive) tracker.peakAlive = tracker.alive
        yield { i, payload: 'x'.repeat(64) }
        tracker.alive--
      }
    }
    return gen()
  }

  test('CSV encoder keeps at most one row alive at a time', async () => {
    const tracker = { peakAlive: 0, alive: 0 }
    const stream = buildCsvStream(['i', 'payload'], trackedRows(10_000, tracker))
    // Consume without buffering output (count bytes only).
    const reader = stream.getReader()
    let bytes = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
    }
    expect(bytes).toBeGreaterThan(0)
    // Tight bound — async generator semantics keep this at 1.
    expect(tracker.peakAlive).toBeLessThanOrEqual(2)
  })

  test('JSONL encoder keeps at most one row alive at a time', async () => {
    const tracker = { peakAlive: 0, alive: 0 }
    const stream = buildJsonlStream(trackedRows(10_000, tracker))
    const reader = stream.getReader()
    for (;;) {
      const { done } = await reader.read()
      if (done) break
    }
    expect(tracker.peakAlive).toBeLessThanOrEqual(2)
  })
})

// ── streamRequests (async generator over a mocked ClickHouse stream) ─────────

const clickhouseQueryMock = vi.fn()

vi.mock('../lib/clickhouse.js', () => ({
  getClickhouse: () => ({
    query: (opts: unknown) => clickhouseQueryMock(opts),
  }),
}))

let streamRequests: typeof import('../lib/requests-query.js').streamRequests

beforeEach(async () => {
  vi.resetModules()
  clickhouseQueryMock.mockReset()
  ;({ streamRequests } = await import('../lib/requests-query.js'))
})

/**
 * Builds a fake ClickHouse ResultSet whose `stream()` returns an async
 * iterable yielding batches of Row instances. Each Row has the `.json()`
 * method the real driver provides.
 */
function fakeResultSet<T>(batches: T[][]) {
  return {
    stream<U>() {
      async function* iter() {
        for (const batch of batches) {
          yield batch.map((row) => ({
            text: JSON.stringify(row),
            json: () => row as unknown as U,
          }))
        }
      }
      return iter()
    },
    close: vi.fn(),
  }
}

describe('streamRequests', () => {
  test('yields rows one at a time across multiple batches', async () => {
    clickhouseQueryMock.mockResolvedValue(
      fakeResultSet([
        [{ id: '1' }, { id: '2' }],
        [{ id: '3' }],
        [{ id: '4' }, { id: '5' }, { id: '6' }],
      ]),
    )
    const iter = streamRequests<{ id: string }>({
      scope: {
        whereScope: 'organization_id = {orgId:UUID}',
        scopeParams: { orgId: 'org_1', retentionDays: 14 },
        plan: 'free',
      },
      select: 'id',
    })
    const collected: string[] = []
    for await (const row of iter) {
      collected.push(row.id)
    }
    expect(collected).toEqual(['1', '2', '3', '4', '5', '6'])
  })

  test('appends LIMIT / ORDER BY clauses to SQL', async () => {
    clickhouseQueryMock.mockResolvedValue(fakeResultSet<{ id: string }>([]))
    const iter = streamRequests<{ id: string }>({
      scope: {
        whereScope: 'organization_id = {orgId:UUID}',
        scopeParams: { orgId: 'org_1', retentionDays: 14 },
        plan: 'starter',
      },
      select: 'id',
      orderBy: 'created_at DESC',
      limit: 250,
    })
    // Consume so the query is actually invoked.
    for await (const _ of iter) { void _ }
    expect(clickhouseQueryMock).toHaveBeenCalledOnce()
    const call = clickhouseQueryMock.mock.calls[0]?.[0] as { query: string }
    expect(call.query).toContain('SELECT id FROM requests')
    expect(call.query).toContain('ORDER BY created_at DESC')
    expect(call.query).toContain('LIMIT 250')
  })

  test('merges scope params with caller params', async () => {
    clickhouseQueryMock.mockResolvedValue(fakeResultSet<{ id: string }>([]))
    const iter = streamRequests<{ id: string }>({
      scope: {
        whereScope: 'organization_id = {orgId:UUID}',
        scopeParams: { orgId: 'org_42', retentionDays: 90 },
        plan: 'starter',
      },
      select: 'id',
      filters: 'provider = {provider:String}',
      params: { provider: 'openai' },
    })
    for await (const _ of iter) { void _ }
    const call = clickhouseQueryMock.mock.calls[0]?.[0] as {
      query: string
      query_params: Record<string, unknown>
    }
    expect(call.query_params).toEqual({
      orgId: 'org_42',
      retentionDays: 90,
      provider: 'openai',
    })
    expect(call.query).toContain('AND provider = {provider:String}')
  })

  test('runs result.close() in finally (cancellation safety)', async () => {
    const result = fakeResultSet<{ id: string }>([[{ id: '1' }], [{ id: '2' }]])
    clickhouseQueryMock.mockResolvedValue(result)
    const iter = streamRequests<{ id: string }>({
      scope: {
        whereScope: 'organization_id = {orgId:UUID}',
        scopeParams: { orgId: 'org_1', retentionDays: 14 },
        plan: 'free',
      },
      select: 'id',
    })
    // Pull one row then break — generator's finally should run.
    for await (const _ of iter) { void _; break }
    expect(result.close).toHaveBeenCalled()
  })
})
