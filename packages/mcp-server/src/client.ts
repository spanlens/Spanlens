/**
 * Spanlens REST API client.
 *
 * Thin wrapper over `fetch` — every method either returns the unwrapped `data`
 * payload from a `{ success: true, data, ... }` envelope or throws a
 * `SpanlensApiError` whose message is suitable for surfacing back through MCP
 * tool errors.
 *
 * The API key validation is intentionally done here (not by checking prefix
 * at startup): the network call to `/api/v1/me/key-info` is the canonical
 * way to confirm the key works AND to read its scope. We assert public
 * scope (not full) at that point so a leaked IDE config can never trigger
 * proxy spend on the user's behalf.
 */

const DEFAULT_BASE_URL = 'https://api.spanlens.io'

/**
 * Per-request budget covering headers AND body. Half the MCP SDK's default
 * 60 s request timeout, so a stalled API surfaces as our own readable error
 * before the IDE gives up on the tool call. It also bounds the startup key
 * check, which runs before any MCP request exists and so has no other limit:
 * without it, Node's fetch waits up to 300 s and then says only "fetch failed".
 */
export const DEFAULT_TIMEOUT_MS = 30_000

/**
 * Upper bound for a configured timeout. Beyond any MCP client's own request
 * timeout, and well inside the range where Node timers stay accurate (a
 * delay above 2^31 - 1 ms silently fires after 1 ms).
 */
export const MAX_TIMEOUT_MS = 600_000

export interface SpanlensClientOptions {
  apiKey: string
  baseUrl?: string
  /** Per-request timeout in ms, headers and body together. Default 30000. */
  timeoutMs?: number
}

function isValidTimeoutMs(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= MAX_TIMEOUT_MS
}

const TIMEOUT_RANGE_HINT = `a whole number of milliseconds between 1 and ${MAX_TIMEOUT_MS}`

/**
 * Parse `SPANLENS_TIMEOUT_MS`. Unset or blank means "use the default"
 * (undefined). Anything else must be a plain integer in range; a typo
 * throws instead of silently falling back, so a user who asked for a
 * longer budget is never left wondering why it had no effect.
 */
export function parseTimeoutMs(raw: string | undefined): number | undefined {
  const trimmed = raw?.trim() ?? ''
  if (trimmed === '') return undefined
  const value = /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN
  if (!isValidTimeoutMs(value)) {
    throw new Error(`SPANLENS_TIMEOUT_MS must be ${TIMEOUT_RANGE_HINT}, got "${trimmed}".`)
  }
  return value
}

/** The Spanlens API sent nothing (or stopped mid-body) within the budget. */
export class SpanlensTimeoutError extends Error {
  constructor(
    public readonly timeoutMs: number,
    public readonly url: string,
  ) {
    super(
      `Spanlens API did not respond within ${timeoutMs} ms (GET ${url}). ` +
        'Check SPANLENS_BASE_URL and your network, or raise SPANLENS_TIMEOUT_MS.',
    )
    this.name = 'SpanlensTimeoutError'
  }
}

export interface SpanlensApiErrorExtras {
  /** Server-assigned request id, for matching a failure to server logs. */
  requestId?: string | null
  details?: Record<string, unknown>
}

export class SpanlensApiError extends Error {
  public readonly requestId: string | null
  public readonly details: Record<string, unknown> | undefined

  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    extras: SpanlensApiErrorExtras = {},
  ) {
    super(message)
    this.name = 'SpanlensApiError'
    this.requestId = extras.requestId ?? null
    this.details = extras.details
  }
}

interface ParsedApiError {
  message: string
  code: string | undefined
  requestId: string | null
  details: Record<string, unknown> | undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Read the error out of a Spanlens response body. Two shapes exist:
 *
 *   current: { error: { code, message, details?, requestId } }
 *            (apps/server/src/app.ts onError, every ApiError throw site)
 *   legacy:  { error: 'message', code?: 'CODE' }
 *            (pre-ApiError routes; older self-hosted builds)
 *
 * Returns null when neither matches so the caller can fall back to a
 * status-only message. v0.2.1 cast `error` to a string unconditionally,
 * which turned every current-shape failure into "[object Object]".
 */
export function parseErrorEnvelope(body: unknown): ParsedApiError | null {
  if (!isRecord(body)) return null
  const { error } = body

  if (isRecord(error)) {
    const code = typeof error['code'] === 'string' ? error['code'] : undefined
    const message =
      typeof error['message'] === 'string' && error['message'] !== '' ? error['message'] : code
    if (message === undefined) return null
    return {
      message,
      code,
      requestId: typeof error['requestId'] === 'string' ? error['requestId'] : null,
      details: isRecord(error['details']) ? error['details'] : undefined,
    }
  }

  if (typeof error === 'string' && error !== '') {
    return {
      message: error,
      code: typeof body['code'] === 'string' ? body['code'] : undefined,
      requestId: null,
      details: undefined,
    }
  }

  return null
}

function toApiError(body: unknown, status: number, fallbackMessage: string): SpanlensApiError {
  const parsed = parseErrorEnvelope(body)
  if (!parsed) return new SpanlensApiError(fallbackMessage, status)
  return new SpanlensApiError(parsed.message, status, parsed.code, {
    requestId: parsed.requestId,
    ...(parsed.details ? { details: parsed.details } : {}),
  })
}

/**
 * One-line description for startup logs and MCP tool errors: the server's
 * message plus whichever identifiers it sent (status, code, requestId), so
 * a user can quote something support can grep for.
 */
export function describeError(err: unknown): string {
  if (err instanceof SpanlensApiError) {
    const tags = [
      `HTTP ${err.status}`,
      err.code,
      err.requestId ? `requestId ${err.requestId}` : undefined,
    ].filter((tag): tag is string => Boolean(tag))
    return `${err.message} (${tags.join(', ')})`
  }
  return err instanceof Error ? err.message : String(err)
}

interface Envelope<T> {
  success: boolean
  data: T
  meta?: { total: number; page: number; limit: number }
}

export interface KeyInfo {
  projectId: string | null
  projectName: string | null
  providers: string[]
  scope: 'full' | 'public'
}

export class SpanlensClient {
  private readonly apiKey: string
  private readonly baseUrl: string
  public readonly timeoutMs: number

  constructor(opts: SpanlensClientOptions) {
    if (!opts.apiKey || opts.apiKey.trim().length === 0) {
      throw new Error('SPANLENS_API_KEY is required')
    }
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
    if (!isValidTimeoutMs(timeoutMs)) {
      throw new Error(`timeoutMs must be ${TIMEOUT_RANGE_HINT}, got ${timeoutMs}.`)
    }
    this.apiKey = opts.apiKey.trim()
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '')
    this.timeoutMs = timeoutMs
  }

  /** GET a JSON envelope, return the unwrapped `data` or throw. */
  async get<T>(path: string, query?: Record<string, string | number | undefined>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`)
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null && v !== '') {
          url.searchParams.set(k, String(v))
        }
      }
    }
    const { res, body } = await this.fetchJson(url)
    if (!res.ok) {
      throw toApiError(body, res.status, `Spanlens API ${res.status}`)
    }
    const env = body as Envelope<T>
    if (env.success === false) {
      throw toApiError(body, res.status, 'Spanlens API returned success=false')
    }
    return env.data
  }

  /**
   * One signal bounds both the fetch and the body read: undici keeps
   * honouring the signal after headers arrive, so a body that stalls
   * mid-stream rejects too. Only failures that happened because OUR signal
   * fired are relabelled as timeouts; any other network error propagates
   * unchanged.
   */
  private async fetchJson(url: URL): Promise<{ res: Response; body: unknown }> {
    const signal = AbortSignal.timeout(this.timeoutMs)
    const timeoutError = (): SpanlensTimeoutError =>
      new SpanlensTimeoutError(this.timeoutMs, `${url.origin}${url.pathname}`)

    let res: Response
    try {
      res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${this.apiKey}`, Accept: 'application/json' },
        signal,
      })
    } catch (err) {
      throw signal.aborted ? timeoutError() : err
    }

    try {
      return { res, body: await res.json() }
    } catch {
      if (signal.aborted) throw timeoutError()
      throw new SpanlensApiError(`Spanlens API ${res.status} (response not JSON)`, res.status)
    }
  }

  /**
   * Introspect the configured API key. Throws if the key is bad. Returns
   * scope so the caller can refuse to start when scope='full' is used in
   * an IDE config (which is where this server lives).
   */
  async keyInfo(): Promise<KeyInfo> {
    return this.get<KeyInfo>('/api/v1/me/key-info')
  }
}
