/**
 * SSE stream pump shared by 3 of the 4 proxy handlers (openai / anthropic /
 * azure). Reads the upstream stream chunk-by-chunk, writes each chunk to
 * the client, accumulates a line-buffered copy for token extraction, and
 * surfaces "truncated by deadline" so the log row can flag the row.
 *
 * Gemini's protocol returns a JSON array (not line-delimited SSE) and is
 * handled separately in proxy/gemini.ts.
 *
 * The pump never throws — a reader error or deadline gracefully ends the
 * loop and the accumulated lines are still passed to the logger so partial
 * traces are visible in the dashboard.
 */

import type { Context } from 'hono'
import { stream } from 'hono/streaming'
import { logError } from '../../lib/structured-logger.js'
import {
  cancelReaderSilently,
  makeStreamDeadline,
  readWithDeadline,
} from '../stream-deadline.js'
import { buildDownstreamHeaders } from '../utils.js'
import type { ProxyProvider } from './provider-key.js'

export interface StreamPumpInput {
  c: Context
  upstreamRes: Response
  handlerStartMs: number
  provider: ProxyProvider
  /**
   * Called after the stream completes with the captured line buffer and
   * the truncated flag. Typically calls logOpenAIStream / logAnthropicStream.
   */
  onComplete: (lines: string[], truncated: boolean) => Promise<unknown>
}

export function runLineBufferedStreamPump(input: StreamPumpInput): Response {
  const upstreamBody = input.upstreamRes.body
  if (!upstreamBody) {
    // Should never happen — callers gate on `isStreaming && upstreamRes.body`.
    // Return the response verbatim if it does.
    return new Response(null, {
      status: input.upstreamRes.status,
      headers: buildDownstreamHeaders(input.upstreamRes.headers),
    })
  }

  const downstreamHeaders = buildDownstreamHeaders(input.upstreamRes.headers)
  downstreamHeaders.forEach((value, key) => input.c.header(key, value))
  input.c.status(input.upstreamRes.status as 200)

  return stream(input.c, async (honoStream) => {
    const reader = upstreamBody.getReader()
    const decoder = new TextDecoder()
    const deadline = makeStreamDeadline(input.handlerStartMs)
    let buffer = ''
    const lines: string[] = []
    let truncated = false

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

    pump: for (;;) {
      const outcome = await readWithDeadline(reader, deadline)
      if (honoStream.aborted) {
        truncated = true
        break pump
      }
      switch (outcome.kind) {
        case 'done':
          break pump
        case 'timeout':
          truncated = true
          await cancelReaderSilently(reader)
          break pump
        case 'error':
          logError('UPSTREAM_FETCH_FAILED', { provider: input.provider, phase: 'stream' }, outcome.error)
          break pump
        case 'chunk': {
          await honoStream.write(outcome.value)
          buffer += decoder.decode(outcome.value, { stream: true })
          const parts = buffer.split('\n')
          buffer = parts.pop() ?? ''
          lines.push(...parts)
          break
        }
      }
    }
    if (buffer.length > 0) lines.push(buffer)

    await input.onComplete(lines, truncated).catch((err) => {
      logError('CH_INSERT_FAILED', { provider: input.provider, phase: 'stream_log' }, err)
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
  handlerStartMs: number
  provider: ProxyProvider
  onComplete: (buffer: string, truncated: boolean) => Promise<unknown>
}

export function runChunkAccumulatedStreamPump(input: ChunkAccumulatedStreamPumpInput): Response {
  const upstreamBody = input.upstreamRes.body
  if (!upstreamBody) {
    return new Response(null, {
      status: input.upstreamRes.status,
      headers: buildDownstreamHeaders(input.upstreamRes.headers),
    })
  }

  const downstreamHeaders = buildDownstreamHeaders(input.upstreamRes.headers)
  downstreamHeaders.forEach((value, key) => input.c.header(key, value))
  input.c.status(input.upstreamRes.status as 200)

  return stream(input.c, async (honoStream) => {
    const reader = upstreamBody.getReader()
    const decoder = new TextDecoder()
    const deadline = makeStreamDeadline(input.handlerStartMs)
    const chunks: string[] = []
    let truncated = false

    // Client disconnect — see runLineBufferedStreamPump for the full rationale
    // (write() never rejects; abort is the only observable signal).
    honoStream.onAbort(() => {
      void cancelReaderSilently(reader)
    })

    pump: for (;;) {
      const outcome = await readWithDeadline(reader, deadline)
      if (honoStream.aborted) {
        truncated = true
        break pump
      }
      switch (outcome.kind) {
        case 'done':
          break pump
        case 'timeout':
          truncated = true
          await cancelReaderSilently(reader)
          break pump
        case 'error':
          logError('UPSTREAM_FETCH_FAILED', { provider: input.provider, phase: 'stream' }, outcome.error)
          break pump
        case 'chunk':
          await honoStream.write(outcome.value)
          chunks.push(decoder.decode(outcome.value, { stream: true }))
          break
      }
    }

    await input.onComplete(chunks.join(''), truncated).catch((err) => {
      logError('CH_INSERT_FAILED', { provider: input.provider, phase: 'stream_log' }, err)
    })
  })
}
