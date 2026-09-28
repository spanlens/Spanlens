import { beforeEach, describe, expect, test, vi } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// P3.11 streaming-exports tests.
//
// Two layers tested:
//   1. `buildCsvStream` / `buildJsonlStream` — pure stream encoders. Fed by a
//      controllable async iterable so we can verify byte-level output for
//      header rows, escaping, line endings, and graceful close.
//   2. Backpressure — with a consumer that reads slowly or not at all, the
//      source may run ahead by at most one queue (high-water mark) of encoded
//      rows, and cancelling or abandoning the stream releases the source.
//
// The streamRequests() helper itself is exercised against a mocked `pgStream`
// async generator, so we cover the SQL assembly + delegation + early-exit
// cleanup path without a live cursor.
// ─────────────────────────────────────────────────────────────────────────────

import { buildCsvStream, buildJsonlStream, withIsoCreatedAt } from '../api/exports.js'
import {
  EXPORT_STREAM_CHUNK_CHARS,
  EXPORT_STREAM_HIGH_WATER_MARK_BYTES,
} from '../lib/export-stream.js'

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

// ── CSV formula-injection guard (OWASP CSV injection) ────────────────────────
//
// Exported cells like error_message carry end-user-controlled LLM text. A cell
// starting with = + - @ (or the tab / CR variants) executes as a formula when
// the export is opened in Excel / Google Sheets. escapeCsv must prefix such
// string cells with a single quote, while numeric cells (formatted by our own
// code, e.g. negative deltas) must pass through untouched.

describe('buildCsvStream formula-injection guard', () => {
  test.each([
    ['=SUM(A1:A9)', "'=SUM(A1:A9)"],
    ['+1+2', "'+1+2"],
    ['-2+3+cmd', "'-2+3+cmd"],
    ['@HYPERLINK("x")', '"\'@HYPERLINK(""x"")"'],
  ])('prefixes string cell %s with a single quote', async (input, expected) => {
    const rows = fromArray<Record<string, unknown>>([{ v: input }])
    const out = await readToString(buildCsvStream(['v'], rows))
    expect(out).toBe(`v\n${expected}\n`)
  })

  test('guards tab / CR leading variants too', async () => {
    const rows = fromArray<Record<string, unknown>>([
      { v: '\t=1+1' },
      { v: '\r=2+2' },
    ])
    const out = await readToString(buildCsvStream(['v'], rows))
    // Tab variant has no chars needing RFC 4180 quoting; CR variant does.
    expect(out).toBe('v\n' + "'\t=1+1\n" + '"\'\r=2+2"\n')
  })

  test('formula trigger combined with quotes/commas is quote-escaped after prefixing', async () => {
    const rows = fromArray<Record<string, unknown>>([
      { v: '=HYPERLINK("http://evil.example","click")' },
    ])
    const out = await readToString(buildCsvStream(['v'], rows))
    expect(out).toBe('v\n' + '"\'=HYPERLINK(""http://evil.example"",""click"")"\n')
  })

  test('does not mangle legitimate negative numbers (typeof number)', async () => {
    const rows = fromArray<Record<string, unknown>>([
      { cost: -0.0042, latency: -5, note: 'ok' },
    ])
    const out = await readToString(buildCsvStream(['cost', 'latency', 'note'], rows))
    expect(out).toBe('cost,latency,note\n-0.0042,-5,ok\n')
  })

  test('leaves benign strings untouched', async () => {
    const rows = fromArray<Record<string, unknown>>([
      { v: 'hello world' },
      { v: 'a=b inside is fine' },
    ])
    const out = await readToString(buildCsvStream(['v'], rows))
    expect(out).toBe('v\nhello world\na=b inside is fine\n')
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

// ── Memory boundedness (backpressure) ────────────────────────────────────────
//
// What has to stay bounded is the encoded output waiting in the stream's queue,
// not the number of rows the generator holds between yields. The first version
// of these tests counted the latter and stayed at 1 while the encoder drained
// the whole cursor into the queue ahead of a slow client: 1M rows measured
// +253MB heap / +614MB RSS with nobody reading (XVERIFY-2026-09-28 C10.1). So
// every test below measures the queue: rows the source has produced minus
// bytes the consumer has taken.

/**
 * Every row encodes to roughly ROW_BYTES in both formats (CSV `i,payload`,
 * JSONL `{"i":…,"payload":"…"}`), and never contains a newline, so the
 * consumer can count rows by counting line feeds.
 */
const ROW_PAYLOAD = 'x'.repeat(1_000)
const ROW_BYTES = 1_000

interface SourceProbe {
  pulled: number
  released: boolean
}

/**
 * Stand-in for the cursor-backed generator: counts what the encoder has
 * pulled and flips `released` in `finally`, the way `pgStream` releases its
 * pooled client. Every `batch` rows it waits a macrotask, the way the cursor
 * waits on a round trip for its next batch.
 */
function probedRows(total: number, probe: SourceProbe, batch = 500): AsyncGenerator<Record<string, unknown>> {
  async function* gen() {
    try {
      for (let i = 0; i < total; i++) {
        if (i > 0 && i % batch === 0) await new Promise<void>((r) => setImmediate(r))
        probe.pulled++
        yield { i, payload: ROW_PAYLOAD }
      }
    } finally {
      probe.released = true
    }
  }
  return gen()
}

function newProbe(): SourceProbe {
  return { pulled: 0, released: false }
}

function countLines(chunk: Uint8Array): number {
  let n = 0
  for (const byte of chunk) if (byte === 0x0a) n++
  return n
}

/** Waits until the source stops advancing (the encoder has stopped pulling). */
async function settle(probe: SourceProbe): Promise<void> {
  let last = -1
  for (let i = 0; i < 100 && probe.pulled !== last; i++) {
    last = probe.pulled
    await new Promise((r) => setTimeout(r, 10))
  }
}

const tick = () => new Promise<void>((r) => setImmediate(r))

/**
 * Rows that may sit between the source and the consumer: a full queue, the
 * chunk being assembled, and one row of slack on each side.
 */
const MAX_QUEUED_ROWS =
  Math.ceil((EXPORT_STREAM_HIGH_WATER_MARK_BYTES + EXPORT_STREAM_CHUNK_CHARS) / ROW_BYTES) + 2

const encoders = [
  ['CSV', (rows: AsyncIterable<Record<string, unknown>>) => buildCsvStream(['i', 'payload'], rows), 1],
  ['JSONL', (rows: AsyncIterable<Record<string, unknown>>) => buildJsonlStream(rows), 0],
] as const

describe.each(encoders)('%s encoder backpressure', (_name, build, headerLines) => {
  test('stops pulling rows once the queue is full and nobody reads', async () => {
    const probe = newProbe()
    // ~20MB of rows; the old start()-loop encoder queued all of it.
    const stream = build(probedRows(20_000, probe))
    await settle(probe)

    expect(probe.pulled).toBeLessThanOrEqual(MAX_QUEUED_ROWS)
    await stream.cancel()
  })

  test('a slow consumer never lets the queue grow past the high-water mark', async () => {
    const probe = newProbe()
    const reader = build(probedRows(5_000, probe)).getReader()
    let consumedRows = -headerLines
    let maxQueuedRows = 0
    for (;;) {
      // Yield to the producer between reads so it runs as far ahead as the
      // stream lets it: that distance is the queue.
      await tick()
      await tick()
      maxQueuedRows = Math.max(maxQueuedRows, probe.pulled - Math.max(0, consumedRows))
      const { done, value } = await reader.read()
      if (done) break
      consumedRows += countLines(value)
    }
    expect(probe.pulled).toBe(5_000)
    expect(consumedRows).toBe(5_000)
    expect(maxQueuedRows).toBeLessThanOrEqual(MAX_QUEUED_ROWS)
  })

  test('cancel releases the source right away and stops pulling', async () => {
    const probe = newProbe()
    // A round trip per row keeps the source mid-flight when cancel lands,
    // which is where a slow client usually leaves a real cursor.
    const reader = build(probedRows(20_000, probe, 1)).getReader()
    await reader.read()
    // Let the source get into a round trip.
    await new Promise((r) => setTimeout(r, 5))
    expect(probe.pulled).toBeLessThan(20_000)
    await reader.cancel()
    // The cursor's connection must be back in the pool by the time cancel()
    // settles, not whenever the next enqueue happens to throw.
    expect(probe.released).toBe(true)
    const pulledAtCancel = probe.pulled
    await settle(probe)
    expect(probe.pulled).toBe(pulledAtCancel)
  })

  test('a stream nobody reads or cancels releases its source after the idle timeout', async () => {
    // The response a middleware drops after the route returned it: the body
    // pump never starts, so neither read() nor cancel() ever comes.
    const probe = newProbe()
    const rows = probedRows(20_000, probe)
    const options = { idleTimeoutMs: 250 }
    const stream =
      _name === 'CSV'
        ? buildCsvStream(['i', 'payload'], rows, options)
        : buildJsonlStream(rows, options)
    await settle(probe)
    expect(probe.released).toBe(false)

    await new Promise((r) => setTimeout(r, 400))
    expect(probe.released).toBe(true)
    // Whatever was queued is discarded: a late reader sees the failure
    // rather than a file that silently stops.
    const reader = stream.getReader()
    await expect(
      (async () => {
        for (;;) if ((await reader.read()).done) return
      })(),
    ).rejects.toThrow(/not read for 250ms/)
  })
})

describe('buildJsonlStream encoder failure', () => {
  test('an encoder throw errors the stream and still releases the source', async () => {
    // JSON.stringify throws on BigInt. The source is suspended at its yield,
    // cursor open, when that happens, so the encoder has to return() it.
    const probe = { released: false }
    async function* rows(): AsyncGenerator<Record<string, unknown>> {
      try {
        yield { i: 1 }
        yield { i: BigInt(2) }
        yield { i: 3 }
      } finally {
        probe.released = true
      }
    }
    await expect(readToString(buildJsonlStream(rows()))).rejects.toThrow(/BigInt/)
    expect(probe.released).toBe(true)
  })
})

// ── streamRequests (delegation to the mocked pgStream cursor) ────────────────

const pgStreamMock = vi.fn()

vi.mock('../lib/postgres.js', async (importOriginal) => {
  // Partial mock: only the driver entry points are stubbed. `toPositional`
  // and the rest stay real so nothing here quietly diverges from production.
  const actual = await importOriginal<typeof import('../lib/postgres.js')>()
  return {
    ...actual,
    pgQuery: vi.fn(async () => []),
    pgExecute: vi.fn(async () => 0),
    pgStream: (opts: unknown) => pgStreamMock(opts),
  }
})

let streamRequests: typeof import('../lib/requests-query.js').streamRequests

beforeEach(async () => {
  vi.resetModules()
  pgStreamMock.mockReset()
  ;({ streamRequests } = await import('../lib/requests-query.js'))
})

const SCOPE_WHERE =
  'organization_id = {orgId} AND created_at >= now() - make_interval(days => {retentionDays})'

/**
 * Stands in for `pgStream`: an async generator over a server-side cursor.
 * `released` flips in the generator's `finally`, mirroring the `client.release()`
 * the real helper runs there — that is what an early `break` has to trigger.
 */
function fakeCursor<T>(rows: T[]) {
  const state = { released: false }
  async function* gen(): AsyncGenerator<T, void, undefined> {
    try {
      for (const row of rows) yield row
    } finally {
      state.released = true
    }
  }
  return { gen, state }
}

describe('streamRequests', () => {
  test('yields every row from the cursor in order', async () => {
    const { gen } = fakeCursor([
      { id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }, { id: '5' }, { id: '6' },
    ])
    pgStreamMock.mockImplementation(() => gen())

    const iter = streamRequests<{ id: string }>({
      scope: {
        whereScope: SCOPE_WHERE,
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
    const { gen } = fakeCursor<{ id: string }>([])
    pgStreamMock.mockImplementation(() => gen())

    const iter = streamRequests<{ id: string }>({
      scope: {
        whereScope: SCOPE_WHERE,
        scopeParams: { orgId: 'org_1', retentionDays: 14 },
        plan: 'starter',
      },
      select: 'id',
      orderBy: 'created_at DESC',
      limit: 250,
    })
    // Consume so the query is actually invoked.
    for await (const _ of iter) { void _ }
    expect(pgStreamMock).toHaveBeenCalledOnce()
    const call = pgStreamMock.mock.calls[0]?.[0] as { query: string }
    expect(call.query).toContain('SELECT id FROM requests')
    expect(call.query).toContain('WHERE organization_id = {orgId}')
    expect(call.query).toContain('ORDER BY created_at DESC')
    expect(call.query).toContain('LIMIT 250')
  })

  test('merges scope params with caller params', async () => {
    const { gen } = fakeCursor<{ id: string }>([])
    pgStreamMock.mockImplementation(() => gen())

    const iter = streamRequests<{ id: string }>({
      scope: {
        whereScope: SCOPE_WHERE,
        scopeParams: { orgId: 'org_42', retentionDays: 90 },
        plan: 'starter',
      },
      select: 'id',
      filters: 'provider = {provider}',
      params: { provider: 'openai' },
    })
    for await (const _ of iter) { void _ }
    const call = pgStreamMock.mock.calls[0]?.[0] as {
      query: string
      params: Record<string, unknown>
    }
    expect(call.params).toEqual({
      orgId: 'org_42',
      retentionDays: 90,
      provider: 'openai',
    })
    expect(call.query).toContain('AND provider = {provider}')
  })

  test('an early break propagates into the cursor so its client is released', async () => {
    // The cursor holds one pooled connection for the life of the iteration.
    // `yield*` has to forward the consumer's `return()` to the inner generator,
    // otherwise abandoning an export mid-stream leaks a connection per request.
    const { gen, state } = fakeCursor([{ id: '1' }, { id: '2' }])
    pgStreamMock.mockImplementation(() => gen())

    const iter = streamRequests<{ id: string }>({
      scope: {
        whereScope: SCOPE_WHERE,
        scopeParams: { orgId: 'org_1', retentionDays: 14 },
        plan: 'free',
      },
      select: 'id',
    })
    // Pull one row then break — the cursor's finally should run.
    for await (const _ of iter) { void _; break }
    expect(state.released).toBe(true)
  })
})

// ── withIsoCreatedAt (row normalisation on the streaming export path) ────────
//
// The name is historical. The `created_at` rewrite it was built for is gone:
// lib/postgres.ts installs a TIMESTAMPTZ parser that already returns canonical
// ISO UTC, and re-converting a value that is already ISO appended a second `Z`
// and produced an unparseable date. What remains, and what these tests pin,
// is that created_at passes through byte-identical and that string-encoded
// numerics become real numbers.

describe('withIsoCreatedAt', () => {
  async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
    const out: T[] = []
    for await (const item of iter) out.push(item)
    return out
  }

  test('passes an already-ISO created_at through untouched (no second Z)', async () => {
    const rows = await collect(withIsoCreatedAt(fromArray([
      { id: '1', created_at: '2026-05-20T07:00:00.000Z' },
      { id: '2', created_at: '2026-05-20T07:00:01.500Z' },
    ])))
    expect(rows).toEqual([
      { id: '1', created_at: '2026-05-20T07:00:00.000Z' },
      { id: '2', created_at: '2026-05-20T07:00:01.500Z' },
    ])
    for (const row of rows) {
      expect(row.created_at).not.toContain('ZZ')
    }
  })

  test('coerces the driver string-encoded numerics to numbers', async () => {
    // `numeric` (cost_usd) and `int8` (token counts, latency, status) arrive as
    // strings from node-postgres — CLAUDE.md gotcha #19 in its Postgres form.
    // JSONL consumers would otherwise get `"0.00012345"` and silently
    // string-concatenate on it.
    const rows = await collect(withIsoCreatedAt(fromArray<Record<string, unknown>>([
      {
        id: 'abc',
        cost_usd: '0.00012345',
        prompt_tokens: '10',
        completion_tokens: '20',
        total_tokens: '30',
        latency_ms: '150',
        status_code: '200',
      },
    ])))
    expect(rows[0]).toEqual({
      id: 'abc',
      cost_usd: 0.00012345,
      prompt_tokens: 10,
      completion_tokens: 20,
      total_tokens: 30,
      latency_ms: 150,
      status_code: 200,
    })
    expect(typeof rows[0]!['cost_usd']).toBe('number')
  })

  test('preserves other fields unchanged (immutable spread)', async () => {
    const source = {
      id: 'abc',
      cost_usd: '0.0042',
      model: 'gpt-4o',
      created_at: '2026-05-20T07:00:00.000Z',
    }
    const rows = await collect(withIsoCreatedAt(fromArray([{ ...source }])))
    expect(rows[0]).toEqual({
      id: 'abc',
      cost_usd: 0.0042,
      model: 'gpt-4o',
      created_at: '2026-05-20T07:00:00.000Z',
    })
    // Source row untouched — the helper copies rather than mutating the row
    // the cursor handed it.
    expect(source.cost_usd).toBe('0.0042')
  })

  test('leaves null / missing numerics alone (unknown cost stays unknown)', async () => {
    const rows = await collect(withIsoCreatedAt(fromArray<Record<string, unknown>>([
      { id: '1', created_at: null, cost_usd: null },
      { id: '2', cost_usd: '' },
    ])))
    expect(rows).toEqual([
      { id: '1', created_at: null, cost_usd: null },
      { id: '2', cost_usd: '' },
    ])
    // Number(null) is 0 and Number('') is 0 — coercing either would invent a
    // $0.00 cost for a request whose price we never resolved.
    expect(rows[0]!['cost_usd']).toBeNull()
  })

  test('UTC parse round-trip — new Date() matches the instant the row claimed', async () => {
    // Regression guard for the double-`Z` bug the removed rewrite caused: an
    // unparseable date shows up downstream as "Invalid Date", not as an error.
    const rows = await collect(withIsoCreatedAt(fromArray([
      { created_at: '2026-05-20T07:00:00.000Z' },
    ])))
    const iso = (rows[0]!['created_at'] as string)
    const parsed = new Date(iso)
    expect(Number.isNaN(parsed.getTime())).toBe(false)
    expect(parsed.getUTCHours()).toBe(7)
    expect(parsed.getUTCDate()).toBe(20)
    expect(parsed.getUTCMonth()).toBe(4) // May = 4
  })
})
