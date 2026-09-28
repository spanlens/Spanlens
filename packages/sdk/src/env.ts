/**
 * Environment lookups shared by the client, the evals API, and every proxy
 * factory, so all of them agree on where a self-hosted Spanlens lives.
 *
 * `SPANLENS_BASE_URL` is the server ORIGIN of a self-hosted deployment (for
 * example `https://spanlens.example.com`), the same value `spanlens init
 * --server-url` writes and the MCP server reads. Resolution order everywhere:
 *
 *   explicit option  >  SPANLENS_BASE_URL  >  hosted https://api.spanlens.io
 *
 * Proxy factories append the hosted route's path to the origin, so
 * `createOpenAI()` lands on `<origin>/proxy/openai/v1`.
 *
 * Every read tolerates runtimes without `process` (browser bundles, some edge
 * workers): the variable is simply treated as unset there.
 */

export const HOSTED_SPANLENS_ORIGIN = 'https://api.spanlens.io'

/** Name of the self-hosted origin variable. */
export const BASE_URL_ENV = 'SPANLENS_BASE_URL'

interface ProcessLike {
  env?: Record<string, string | undefined>
}

/** Read an environment variable, or `undefined` when there is no `process`. */
export function readEnv(name: string): string | undefined {
  const proc = (globalThis as { process?: ProcessLike }).process
  const value = proc?.env?.[name]
  return typeof value === 'string' ? value : undefined
}

function stripTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, '')
}

/** `SPANLENS_BASE_URL` without whitespace or trailing slashes; `undefined` when unset or blank. */
export function selfHostedOrigin(): string | undefined {
  const raw = readEnv(BASE_URL_ENV)?.trim()
  if (!raw) return undefined
  return stripTrailingSlashes(raw) || undefined
}

/** Base URL for ingest and REST calls (`/ingest/*`, `/api/v1/*`). */
export function resolveApiBaseUrl(explicit?: string): string {
  return stripTrailingSlashes(explicit ?? selfHostedOrigin() ?? HOSTED_SPANLENS_ORIGIN)
}

/**
 * Proxy base URL for a provider factory when the caller passed none: the
 * self-hosted origin plus the hosted route's path, or the hosted route itself.
 *
 * @param hostedDefault The hosted proxy route, e.g.
 *   `https://api.spanlens.io/proxy/openai/v1`.
 */
export function resolveProxyBaseUrl(hostedDefault: string): string {
  const origin = selfHostedOrigin()
  if (!origin) return hostedDefault
  return `${origin}${new URL(hostedDefault).pathname}`
}
