/**
 * Safe descriptions of transport failures between the proxy and a provider,
 * for the `error_message` column of a request row.
 *
 * The raw error text is deliberately not stored. undici's messages are mostly
 * generic ("fetch failed", "terminated"), but causes can carry request detail,
 * and for Gemini the provider credential rides in the URL query. A stable code
 * (`ECONNRESET`, `ENOTFOUND`, `UND_ERR_SOCKET`, ...) is what an operator needs
 * to tell a DNS problem from a reset, and it cannot leak anything.
 */

const CODE_SHAPE = /^[A-Z][A-Z0-9_]{1,40}$/

/** The system / undici error code behind a fetch or stream failure, if any. */
export function transportErrorCode(err: unknown): string | null {
  const cause = typeof err === 'object' && err !== null ? (err as { cause?: unknown }).cause : undefined
  for (const candidate of [cause, err]) {
    if (typeof candidate !== 'object' || candidate === null) continue
    const code = (candidate as { code?: unknown }).code
    if (typeof code === 'string' && CODE_SHAPE.test(code)) return code
  }
  return null
}

/** `summary`, followed by the error code in parentheses when there is one. */
export function describeTransportError(summary: string, err: unknown): string {
  const code = transportErrorCode(err)
  return code ? `${summary} (${code})` : summary
}
