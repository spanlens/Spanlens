/**
 * Body-retention policy shared by every place that persists prompt or
 * completion text.
 *
 * Two questions, answered once here so the `requests` row and the span copy
 * of the same call can never disagree:
 *
 *   1. Should this call's bodies be stored at all?  (`resolveBodyRetention`)
 *      The customer's `x-spanlens-log-body` mode ('meta' / 'none' drop bodies)
 *      and the org's body_sample_rate both feed it.
 *   2. What exactly gets written when they are?  (`truncateBodyForStorage`,
 *      `sanitizeJsonForStorage`) API-key patterns are masked and anything
 *      above the inline cap is replaced by a preview envelope.
 *
 * The span writers (proxy/stream-logger.ts, api/ingest.ts) used to skip both
 * questions and store the raw text, so a customer who opted out of body
 * logging still had their prompts on the span. Route every new body write
 * through this module.
 */

import { maskApiKeys } from './pii-mask.js'
import { getOrgBodySampleRate, shouldStoreBody } from './org-log-config.js'
import type { LogBodyMode } from './logger.js'

/**
 * Bodies above this size are truncated before insertion. TOAST compresses the
 * body columns well, so the inline cap is generous, but rows still stay
 * bounded so a scan over a month of traffic does not drag whole prompts
 * through memory.
 *
 * Larger bodies are replaced with a preview + size metadata. Phase 2 may move
 * full bodies to object storage and link by reference.
 */
export const MAX_BODY_INLINE_BYTES = 64 * 1024
const PREVIEW_BYTES = 2 * 1024

const NOT_SERIALIZABLE = { _error: 'body not JSON-serializable' } as const

/**
 * Decides whether this call's bodies are kept. Bodies are kept only in 'full'
 * mode (the default when the header is absent) and only for the org's
 * sampled fraction of calls. `rng` is injectable for tests.
 *
 * Callers that write the same call's body to more than one place must resolve
 * this ONCE and reuse the answer: two draws against a partial sample rate
 * would store the body in one place and drop it in the other.
 */
export async function resolveBodyRetention(
  organizationId: string,
  logBodyMode: LogBodyMode | undefined,
  rng: number = Math.random(),
): Promise<boolean> {
  const fullMode = (logBodyMode ?? 'full') === 'full'
  // No sample-rate lookup when the mode already rules the body out.
  if (!fullMode) return false
  const sampleRate = await getOrgBodySampleRate(organizationId)
  return shouldStoreBody(fullMode, sampleRate, rng)
}

/**
 * Returns the body shape that will go into a body column. Above the inline
 * cap, replaces it with a preview + size envelope; otherwise returns the body
 * as-is for downstream serialization.
 */
export function truncateBodyForStorage(body: unknown): unknown {
  if (body == null) return null

  let serialized: string
  try {
    serialized = typeof body === 'string' ? body : JSON.stringify(body)
  } catch {
    return { ...NOT_SERIALIZABLE }
  }

  const bytes = new TextEncoder().encode(serialized).byteLength
  if (bytes <= MAX_BODY_INLINE_BYTES) return body

  const preview = serialized.slice(0, PREVIEW_BYTES)
  return {
    _truncated: true,
    _original_size_bytes: bytes,
    _preview: preview,
    _note: `Body exceeded ${MAX_BODY_INLINE_BYTES} bytes and was truncated.`,
  }
}

/**
 * Masks API-key patterns without changing the value's JSON shape: strings
 * stay strings, objects and arrays stay objects and arrays. Safe because the
 * masked token (`<prefix>***`) never contains a quote or backslash, so the
 * re-parse always succeeds.
 */
function maskPreservingShape(value: unknown): unknown {
  if (typeof value === 'string') return maskApiKeys(value)
  let serialized: string | undefined
  try {
    serialized = JSON.stringify(value)
  } catch {
    return { ...NOT_SERIALIZABLE }
  }
  if (serialized === undefined) return null
  return JSON.parse(maskApiKeys(serialized)) as unknown
}

/**
 * Masked + capped body for jsonb columns (spans.input / spans.output), which
 * have to keep their JSON shape for the trace view. The `requests` columns go
 * through maskApiKeysInBody instead, which flattens to a string.
 *
 * Masks before truncating, so a key straddling the preview boundary cannot
 * leave a partial key in `_preview`.
 */
export function sanitizeJsonForStorage(value: unknown): unknown {
  if (value == null) return null
  return truncateBodyForStorage(maskPreservingShape(value))
}
