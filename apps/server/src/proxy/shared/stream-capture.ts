/**
 * Bounded in-memory copy of a proxied stream, kept for the log row.
 *
 * The pumps used to keep every line / chunk of a stream until it ended. What
 * the copy is for does not need all of it:
 *   - usage parsing reads the START (Anthropic's message_start carries the
 *     prompt tokens) and the END (OpenAI-style and Gemini streams report
 *     usage in the final chunk);
 *   - the stored response body is capped at 64 KiB by logger.ts anyway;
 *   - the response security scan is the one consumer that reads everything.
 *
 * The stream deadline was the only bound, and a fast provider can push well
 * over 50 MB of SSE through in 290s (SSE framing is roughly 40x the text it
 * carries). So the copy keeps a generous head and a tail, and drops the
 * middle once the head is full. The client still receives every byte; only
 * our copy is trimmed.
 *
 * Consequences of hitting the cap, deliberately accepted:
 *   - the security scan covers the head and the tail, not the middle;
 *   - text rebuilt from the copy is missing the middle. With these limits
 *     that only happens far past the 64 KiB body cap, where the stored body
 *     is already a short preview of the head.
 * A capped stream is logged (UNCATEGORIZED / stream_capture_capped).
 */

export interface CaptureLimits {
  /** Characters kept from the start of the stream. */
  headChars: number
  /** Characters kept from the end once the head is full. */
  tailChars: number
}

export const STREAM_CAPTURE_LIMITS: CaptureLimits = {
  headChars: 8 * 1024 * 1024,
  tailChars: 1024 * 1024,
}

export interface StreamCapture {
  /** Adds the next piece (a line, or a raw chunk) of the stream. */
  push(piece: string): void
  /** The kept pieces: the head, then the tail. */
  pieces(): string[]
  /**
   * The kept pieces as one string, with `seam` between head and tail when
   * something was dropped. For raw chunks, whose boundaries fall mid-line, a
   * line break keeps the two partial lines at the seam from fusing into one
   * that a parser could mistake for real data.
   */
  joined(seam: string): string
  /** Characters dropped from the middle; 0 when the stream fit. */
  droppedChars(): number
}

/**
 * Head + sliding tail over the pieces of one stream. The newest piece is
 * always kept, even when it alone exceeds the tail budget, so the final
 * usage chunk cannot be evicted by its own size.
 */
export function createStreamCapture(limits: CaptureLimits = STREAM_CAPTURE_LIMITS): StreamCapture {
  const head: string[] = []
  let headChars = 0
  let headFull = false

  // Array + start index rather than shift(), which is O(n) per eviction.
  const tail: string[] = []
  let tailStart = 0
  let tailChars = 0
  let dropped = 0

  const compactTail = (): void => {
    if (tailStart > 1024 && tailStart * 2 > tail.length) {
      tail.splice(0, tailStart)
      tailStart = 0
    }
  }

  return {
    push(piece) {
      if (!headFull && headChars + piece.length <= limits.headChars) {
        head.push(piece)
        headChars += piece.length
        return
      }
      headFull = true
      tail.push(piece)
      tailChars += piece.length
      while (tailChars > limits.tailChars && tailStart < tail.length - 1) {
        const evicted = tail[tailStart]!
        tailChars -= evicted.length
        dropped += evicted.length
        tailStart += 1
      }
      compactTail()
    },
    pieces() {
      return [...head, ...tail.slice(tailStart)]
    },
    joined(seam) {
      const tailText = tail.slice(tailStart).join('')
      return head.join('') + (dropped > 0 ? seam : '') + tailText
    },
    droppedChars() {
      return dropped
    },
  }
}
