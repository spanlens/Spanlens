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

export interface SpanlensClientOptions {
  apiKey: string
  baseUrl?: string
}

export class SpanlensApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message)
    this.name = 'SpanlensApiError'
  }
}

interface Envelope<T> {
  success: boolean
  data: T
  meta?: { total: number; page: number; limit: number }
  error?: string
  code?: string
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

  constructor(opts: SpanlensClientOptions) {
    if (!opts.apiKey || opts.apiKey.trim().length === 0) {
      throw new Error('SPANLENS_API_KEY is required')
    }
    this.apiKey = opts.apiKey.trim()
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '')
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
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${this.apiKey}`, Accept: 'application/json' },
    })
    let body: unknown
    try {
      body = await res.json()
    } catch {
      throw new SpanlensApiError(
        `Spanlens API ${res.status} (response not JSON)`,
        res.status,
      )
    }
    if (!res.ok) {
      const env = body as { error?: string; code?: string }
      throw new SpanlensApiError(
        env.error ?? `Spanlens API ${res.status}`,
        res.status,
        env.code,
      )
    }
    const env = body as Envelope<T>
    if (env.success === false) {
      throw new SpanlensApiError(env.error ?? 'Spanlens API returned success=false', res.status)
    }
    return env.data
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
