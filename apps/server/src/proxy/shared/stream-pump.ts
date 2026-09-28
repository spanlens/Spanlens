/**
 * SSE stream pump shared by every proxy handler. Reads the upstream stream
 * chunk-by-chunk, writes each chunk to the client, accumulates a copy for
 * token extraction, and reports WHY the stream ended so the log row can say
 * whether it is complete.
 *
 * Two accumulation shapes: line-buffered (OpenAI-style SSE, Anthropic typed
 * events) and raw chunks (Gemini, whose parser walks the whole buffer).
 *
 * The pump never throws — a reader error or deadline gracefully ends the
 * loop and the accumulated lines are still passed to the logger so partial
 * traces are visible in the dashboard.
 */

import type { Context } from 'hono'
import { stream } from 'hono/streaming'
import type { StreamingApi } from 'hono/utils/stream'
import { logError } from '../../lib/structured-logger.js'
import {
  STREAM_DEADLINE_MS,
  cancelReaderSilently,
  makeStreamDeadline,
  readWithDeadline,
  type StreamDeadline,
} from '../stream-deadline.js'
import { buildDownstreamHeaders } from '../utils.js'
import type { ProxyProvider } from './provider-key.js'
import { describeTransportError } from './upstream-errors.js'

/**
 * Why a proxied stream stopped.
 *   - `complete`: the provider closed it normally.
 *   - `deadline`: we closed it at STREAM_DEADLINE_MS (stream-deadline.ts).
 *   - `client_disconnect`: the caller went away; we cancelled the upstream.
 *   - `upstream_error`: the provider's connection failed mid-stream. The
 *     response headers had already gone out as 200, so this is the only
 *     place the failure can still be recorded.
 */
export type StreamEndReason = 'complete' | 'deadline' | 'client_disconnect' | 'upstream_error'

export interface StreamEnd {
  reason: StreamEndReason
  /**
   * For the row's error_message. Set when the stream was cut short by the
   * provider or by our own deadline. Null for a clean end, and for a client
   * that left, since stopping a generation early is the caller's choice
   * rather than a failure.
   */
  errorMessage: string | null
}

const END_COMPLETE: StreamEnd = { reason: 'complete', errorMessage: null }
const END_CLIENT_DISCONNECT: StreamEnd = { reason: 'client_disconnect', errorMessage: null }
const END_DEADLINE: StreamEnd = {
  reason: 'deadline',
  errorMessage: `Stream closed at the proxy deadline of ${STREAM_DEADLINE_MS}ms before the provider finished`,
}

/** Rows are incomplete for every reason but a clean end. */
function isTruncated(end: StreamEnd): boolean {
  return end.reason !== 'complete'
}

/**
 * Forwards upstream chunks to the client until the stream ends, handing each
 * chunk to `onChunk` for capture. Returns why it ended.
 */
async function pumpUpstream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  honoStream: StreamingApi,
  deadline: StreamDeadline,
  provider: ProxyProvider,
  onChunk: (chunk: Uint8Array) => void,
): Promise<StreamEnd> {
  // Client disconnect: honoStream.write() NEVER rejects — hono's
  // StreamingApi.write() swallows writer errors internally — so a try/catch
  // around the write cannot observe the client leaving (that was the #388
  // approach; it was dead code). What DOES fire: when api/index.ts cancels
  // the downstream response stream (Node socket 'close'), hono's
  // responseReadable cancel handler calls stream.abort(). Subscribe to that
  // and cancel the UPSTREAM reader so the pending read resolves, the pump
  // exits, and the partial row is still logged (truncated).
  honoStream.onAbort(() => {
    void cancelReaderSilently(reader)
  })

  for (;;) {
    const outcome = await readWithDeadline(reader, deadline)
    if (honoStream.aborted) return END_CLIENT_DISCONNECT
    switch (outcome.kind) {
      case 'done':
        return END_COMPLETE
      case 'timeout':
        await cancelReaderSilently(reader)
        return END_DEADLINE
      case 'error':
        logError('UPSTREAM_FETCH_FAILED', { provider, phase: 'stream' }, outcome.error)
        return {
          reason: 'upstream_error',
          errorMessage: describeTransportError('Upstream stream interrupted before completion', outcome.error),
        }
      case 'chunk':
        await honoStream.write(outcome.value)
        onChunk(outcome.value)
        break
    }
  }
}

/**
 * Sets the downstream status + headers from the upstream response. Returns
 * false when there is no body to pump (callers gate on `upstreamRes.body`, so
 * this should not happen; the response is then returned verbatim).
 */
function forwardHead(c: Context, upstreamRes: Response): boolean {
  if (!upstreamRes.body) return false
  buildDownstreamHeaders(upstreamRes.headers).forEach((value, key) => c.header(key, value))
  c.status(upstreamRes.status as 200)
  return true
}

function bodylessResponse(upstreamRes: Response): Response {
  return new Response(null, {
    status: upstreamRes.status,
    headers: buildDownstreamHeaders(upstreamRes.headers),
  })
}

export interface StreamPumpInput {
  c: Context
  upstreamRes: Response
  /** When the request reached the proxy; the stream deadline counts from here. */
  requestStartMs: number
  provider: ProxyProvider
  /**
   * Called after the stream ends with the captured line buffer, whether the
   * row is incomplete (`truncated`), and why it ended (`end`). Typically calls
   * logOpenAIStream / logAnthropicStream with `end.errorMessage` on the base.
   */
  onComplete: (lines: string[], truncated: boolean, end: StreamEnd) => Promise<unknown>
}

export function runLineBufferedStreamPump(input: StreamPumpInput): Response {
  const upstreamBody = input.upstreamRes.body
  if (!upstreamBody || !forwardHead(input.c, input.upstreamRes)) {
    return bodylessResponse(input.upstreamRes)
  }

  return stream(input.c, async (honoStream) => {
    const reader = upstreamBody.getReader()
    const decoder = new TextDecoder()
    const lines: string[] = []
    let buffer = ''

    const end = await pumpUpstream(
      reader,
      honoStream,
      makeStreamDeadline(input.requestStartMs),
      input.provider,
      (chunk) => {
        buffer += decoder.decode(chunk, { stream: true })
        const parts = buffer.split('\n')
        buffer = parts.pop() ?? ''
        lines.push(...parts)
      },
    )
    if (buffer.length > 0) lines.push(buffer)

    await input.onComplete(lines, isTruncated(end), end).catch((err) => {
      logError('REQUEST_LOG_INSERT_FAILED', { provider: input.provider, phase: 'stream_log' }, err)
    })
  })
}

/**
 * Chunk-accumulating pump for Gemini's JSON-array stream protocol.
 * Same pump skeleton but writes the raw buffer (not line splits) to the
 * onComplete callback, because Gemini's parser walks the full JSON array.
 */
export interface ChunkAccumulatedStreamPumpInput {
  c: Context
  upstreamRes: Response
  /** When the request reached the proxy; the stream deadline counts from here. */
  requestStartMs: number
  provider: ProxyProvider
  onComplete: (buffer: string, truncated: boolean, end: StreamEnd) => Promise<unknown>
}

export function runChunkAccumulatedStreamPump(input: ChunkAccumulatedStreamPumpInput): Response {
  const upstreamBody = input.upstreamRes.body
  if (!upstreamBody || !forwardHead(input.c, input.upstreamRes)) {
    return bodylessResponse(input.upstreamRes)
  }

  return stream(input.c, async (honoStream) => {
    const reader = upstreamBody.getReader()
    const decoder = new TextDecoder()
    const chunks: string[] = []

    const end = await pumpUpstream(
      reader,
      honoStream,
      makeStreamDeadline(input.requestStartMs),
      input.provider,
      (chunk) => {
        chunks.push(decoder.decode(chunk, { stream: true }))
      },
    )

    await input.onComplete(chunks.join(''), isTruncated(end), end).catch((err) => {
      logError('REQUEST_LOG_INSERT_FAILED', { provider: input.provider, phase: 'stream_log' }, err)
    })
  })
}
