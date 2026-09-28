/**
 * LangChain handler shared across runs (C14.1) and its byte limits (C14.2).
 *
 * The docs recommend one handler per process, shared by parallel
 * invocations. It used to keep ONE lazily-created trace for the whole
 * handler: two overlapping root runs landed in the same trace, the second
 * root's error never reached the trace status, and after one overlap every
 * later root was appended to a trace that never ended.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSpanlensCallbackHandler } from '../integrations/langchain.js'
import { SpanlensClient } from '../client.js'

interface Call {
  method: string
  path: string
  body: Record<string, unknown>
}

function stubFetch() {
  const calls: Call[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit) => {
      calls.push({
        method: init.method ?? 'GET',
        path: new URL(url).pathname,
        body: init.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {},
      })
      return Promise.resolve(new Response('{}', { status: 200 }))
    }),
  )
  return calls
}

const TRACE_PATCH = /^\/ingest\/traces\/([^/]+)$/
const SPAN_POST = /^\/ingest\/traces\/([^/]+)\/spans$/

function tracesCreated(calls: Call[]): string[] {
  return calls
    .filter((c) => c.method === 'POST' && c.path === '/ingest/traces')
    .map((c) => String(c.body['id']))
}

function traceEnds(calls: Call[]): Map<string, string> {
  const ends = new Map<string, string>()
  for (const c of calls) {
    const m = c.method === 'PATCH' ? TRACE_PATCH.exec(c.path) : null
    if (m) ends.set(m[1]!, String(c.body['status']))
  }
  return ends
}

/** span name → trace id it was POSTed under */
function spanTraces(calls: Call[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const c of calls) {
    const m = c.method === 'POST' ? SPAN_POST.exec(c.path) : null
    if (m) out[String(c.body['name'])] = m[1]!
  }
  return out
}

function makeClient(extra: Partial<ConstructorParameters<typeof SpanlensClient>[0]> = {}) {
  return new SpanlensClient({ apiKey: 'sl_live_test', baseUrl: 'http://x', ...extra })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('shared handler, overlapping root runs (C14.1)', () => {
  it('gives each root run its own trace, closed with that root’s status', async () => {
    const calls = stubFetch()
    const client = makeClient()
    const handler = createSpanlensCallbackHandler({ client })

    // A and B overlap; B's child starts after A has already finished.
    handler.handleChainStart({ id: ['A'] }, {}, 'run-a')
    handler.handleChainStart({ id: ['B'] }, {}, 'run-b')
    await handler.handleChainEnd({}, 'run-a')
    handler.handleToolStart({ id: ['Search'] }, 'q', 'run-b-tool', 'run-b')
    await handler.handleToolEnd('result', 'run-b-tool')
    await handler.handleChainError(new Error('B failed'), 'run-b')
    // A later, strictly sequential root.
    handler.handleChainStart({ id: ['C'] }, {}, 'run-c')
    await handler.handleChainEnd({}, 'run-c')
    await client.flush()

    const created = tracesCreated(calls)
    const spans = spanTraces(calls)
    const ends = traceEnds(calls)

    expect(created).toHaveLength(3)
    expect(new Set([spans['chain.A'], spans['chain.B'], spans['chain.C']]).size).toBe(3)
    expect(spans['tool.Search']).toBe(spans['chain.B'])

    expect(ends.get(spans['chain.A']!)).toBe('completed')
    expect(ends.get(spans['chain.B']!)).toBe('error')
    expect(ends.get(spans['chain.C']!)).toBe('completed')
    // No orphans: every trace that was opened was closed.
    expect(created.every((id) => ends.has(id))).toBe(true)
    expect(ends.size).toBe(3)
  })

  it('keeps an overlapping error run even when sampling drops the successful one', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const calls = stubFetch()
    const client = makeClient({ sampleRate: 0 })
    const handler = createSpanlensCallbackHandler({ client })

    handler.handleChainStart({ id: ['A'] }, {}, 'run-a')
    handler.handleChainStart({ id: ['B'] }, {}, 'run-b')
    await handler.handleChainEnd({}, 'run-a')
    await handler.handleChainError(new Error('B failed'), 'run-b')
    await client.flush()

    const spans = spanTraces(calls)
    expect(Object.keys(spans)).toEqual(['chain.B'])
    expect(tracesCreated(calls)).toEqual([spans['chain.B']])
    expect(traceEnds(calls).get(spans['chain.B']!)).toBe('error')
    const spanEnd = calls.find((c) => c.method === 'PATCH' && c.path.startsWith('/ingest/spans/'))
    expect(spanEnd?.body['error_message']).toBe('B failed')
  })

  it('never ends a caller-supplied trace, even with overlapping roots', async () => {
    const calls = stubFetch()
    const client = makeClient()
    const trace = client.startTrace({ name: 'outer' })
    const handler = createSpanlensCallbackHandler({ client, trace })

    handler.handleChainStart({ id: ['A'] }, {}, 'run-a')
    handler.handleChainStart({ id: ['B'] }, {}, 'run-b')
    await handler.handleChainEnd({}, 'run-a')
    await handler.handleChainError(new Error('x'), 'run-b')
    await client.flush()

    const spans = spanTraces(calls)
    expect(spans['chain.A']).toBe(trace.traceId)
    expect(spans['chain.B']).toBe(trace.traceId)
    expect(traceEnds(calls).size).toBe(0)
  })
})

describe('maxInputBytes / maxOutputBytes count UTF-8 bytes (C14.2)', () => {
  const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

  function utf8Bytes(s: string): number {
    return new TextEncoder().encode(s).length
  }

  async function inputOf(handlerInput: string, maxInputBytes: number) {
    const calls = stubFetch()
    const client = makeClient()
    const handler = createSpanlensCallbackHandler({ client, maxInputBytes })
    handler.handleToolStart({ id: ['T'] }, handlerInput, 'tool-1')
    await handler.handleToolEnd('ok', 'tool-1')
    await client.flush()
    const post = calls.find((c) => c.method === 'POST' && SPAN_POST.test(c.path))
    return post?.body['input']
  }

  it('truncates multi-byte input that fits in UTF-16 units but not in bytes', async () => {
    const text = '가나다라마바사아' // JSON: 10 UTF-16 units, 26 UTF-8 bytes
    const input = (await inputOf(text, 10)) as Record<string, unknown>

    expect(input['__truncated']).toBe(true)
    expect(input['originalBytes']).toBe(utf8Bytes(JSON.stringify(text)))
    expect(utf8Bytes(String(input['preview']))).toBeLessThanOrEqual(10)
  })

  it('never splits a surrogate pair and keeps the preview within the byte cap', async () => {
    const text = '😀'.repeat(60)
    const input = (await inputOf(text, 100)) as Record<string, unknown>
    const preview = String(input['preview'])

    expect(input['originalBytes']).toBe(utf8Bytes(JSON.stringify(text)))
    expect(utf8Bytes(preview)).toBeLessThanOrEqual(100)
    expect(LONE_SURROGATE.test(preview)).toBe(false)
  })

  it('leaves input that fits in bytes untouched', async () => {
    expect(await inputOf('가나', 10)).toBe('가나') // JSON "가나" = 8 bytes
  })

  it('applies the same byte rule to span output', async () => {
    const calls = stubFetch()
    const client = makeClient()
    const handler = createSpanlensCallbackHandler({ client, maxOutputBytes: 10 })
    handler.handleToolStart({ id: ['T'] }, 'q', 'tool-1')
    await handler.handleToolEnd('가나다라마바사아', 'tool-1')
    await client.flush()

    const patch = calls.find((c) => c.method === 'PATCH' && c.path.startsWith('/ingest/spans/'))
    const output = patch?.body['output'] as Record<string, unknown>
    expect(output['__truncated']).toBe(true)
    expect(utf8Bytes(String(output['preview']))).toBeLessThanOrEqual(10)
  })
})
