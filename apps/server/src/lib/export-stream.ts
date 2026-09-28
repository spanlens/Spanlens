/**
 * Pull-based byte stream over an async row source, for the streamed
 * `/api/v1/exports/requests` formats (CSV, JSONL).
 *
 * Why pull and not a `start()` loop: `start()` runs once, and
 * `controller.enqueue()` never blocks, so a loop there drains the whole
 * cursor into the stream's queue as fast as Postgres hands rows over, however
 * slowly the client reads. A 1M-row export with a client that stopped reading
 * measured +253MB heap / +614MB RSS that way (XVERIFY-2026-09-28 C10.1).
 *
 * `pull()` is only called while the queue is below its high-water mark, so the
 * chain now runs the other way: the Node socket stops draining, `api/index.ts`
 * stops calling `reader.read()`, the queue fills, `pull()` stops being called,
 * the row generator stays suspended at its `yield`, and the cursor stops
 * fetching batches. Memory on our side is bounded by the high-water mark plus
 * the chunk being assembled plus whatever the cursor has already fetched
 * (one batch).
 *
 * The flip side is that a slow download now holds its connection for as long
 * as it takes, instead of releasing it early and paying in memory. pgStream
 * (lib/postgres.ts) accounts for that: the cursor has its own small pool, so
 * it cannot starve request logging, and its own time budget, so the session
 * statement_timeout does not end a slow download partway. `cancel` and the
 * idle watchdog below still release the source eagerly, because an abandoned
 * cursor keeps a backend busy and blocks every other export on the instance.
 */

/** Queue bound in encoded bytes. Past this, `pull()` stops being called. */
export const EXPORT_STREAM_HIGH_WATER_MARK_BYTES = 1024 * 1024

/**
 * Target size of one enqueued chunk, counted in UTF-16 code units before
 * encoding (close to bytes for the ASCII-heavy rows an export carries).
 * Batching rows into one chunk keeps the queue from holding one Uint8Array
 * object per row, and turns into fewer, larger socket writes.
 */
export const EXPORT_STREAM_CHUNK_CHARS = 64 * 1024

/**
 * How long the stream may go without a `pull()` before it gives up on its
 * consumer and releases the source.
 *
 * A live client that reads slowly still pulls whenever its socket drains, and
 * a client that disconnects is cancelled by `api/index.ts`. This covers the
 * stream nobody will ever read or cancel: a response dropped after the route
 * returned it (a middleware or the Node bridge throwing before the body pump
 * starts). Without it, that stream would keep its cursor, and its pooled
 * connection, suspended forever. 300s matches the function's maxDuration
 * (vercel.json), past which no invocation can still be reading.
 */
export const EXPORT_STREAM_IDLE_TIMEOUT_MS = 300_000

export interface RowStreamOptions {
  /** Text emitted before the first row, e.g. a CSV header line. */
  readonly preamble?: string
  readonly highWaterMarkBytes?: number
  readonly chunkChars?: number
  readonly idleTimeoutMs?: number
}

/**
 * Encodes `rows` into a byte stream, one `encodeRow` string per row, reading
 * the source only as fast as the consumer drains the stream.
 *
 * Errors from the source or the encoder error the stream (the consumer's
 * `read()` rejects). Cancelling the stream, erroring it, or leaving it idle
 * past `idleTimeoutMs` calls `return()` on the source, which for the export's
 * cursor generator runs `pgStream`'s `finally` and releases the connection.
 */
export function encodeRowStream<Row>(
  rows: AsyncIterable<Row>,
  encodeRow: (row: Row) => string,
  options: RowStreamOptions = {},
): ReadableStream<Uint8Array> {
  const {
    preamble = '',
    highWaterMarkBytes = EXPORT_STREAM_HIGH_WATER_MARK_BYTES,
    chunkChars = EXPORT_STREAM_CHUNK_CHARS,
    idleTimeoutMs = EXPORT_STREAM_IDLE_TIMEOUT_MS,
  } = options
  const encoder = new TextEncoder()
  const iterator = rows[Symbol.asyncIterator]()
  // Closed, errored, or cancelled: nothing may be enqueued after this.
  let finished = false
  let idleTimer: ReturnType<typeof setTimeout> | undefined

  const stopIdleTimer = (): void => {
    if (idleTimer === undefined) return
    clearTimeout(idleTimer)
    idleTimer = undefined
  }

  // `return()` on an async generator that is mid-`next()` is queued behind
  // that call, so this waits for an in-flight batch rather than interrupting
  // it. Errors are swallowed: the source is being abandoned either way.
  const releaseSource = async (): Promise<void> => {
    try {
      await iterator.return?.()
    } catch {
      // Already failing or already finished.
    }
  }

  const armIdleTimer = (controller: ReadableStreamDefaultController<Uint8Array>): void => {
    idleTimer = setTimeout(() => {
      idleTimer = undefined
      if (finished) return
      finished = true
      void releaseSource()
      controller.error(new Error(`export stream not read for ${idleTimeoutMs}ms; released its source`))
    }, idleTimeoutMs)
    // Never keep a process alive just to time out an abandoned export.
    idleTimer.unref?.()
  }

  return new ReadableStream<Uint8Array>(
    {
      start(controller) {
        if (preamble) controller.enqueue(encoder.encode(preamble))
      },

      async pull(controller) {
        stopIdleTimer()
        let text = ''
        try {
          while (text.length < chunkChars) {
            const next = await iterator.next()
            if (finished) return
            if (next.done) {
              finished = true
              if (text) controller.enqueue(encoder.encode(text))
              controller.close()
              return
            }
            text += encodeRow(next.value)
          }
        } catch (err) {
          if (finished) return
          finished = true
          // An encoder throw leaves the source suspended at its yield, still
          // holding the cursor; a source throw has already finished it.
          await releaseSource()
          controller.error(err)
          return
        }
        controller.enqueue(encoder.encode(text))
        armIdleTimer(controller)
      },

      async cancel() {
        finished = true
        stopIdleTimer()
        await releaseSource()
      },
    },
    { highWaterMark: highWaterMarkBytes, size: (chunk) => chunk.byteLength },
  )
}
