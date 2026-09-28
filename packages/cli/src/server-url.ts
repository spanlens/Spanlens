import { PROVIDER_CONFIGS, type Provider } from './providers.js'

/**
 * `--server-url` handling for self-hosted Spanlens.
 *
 * The value the wizard writes to SPANLENS_BASE_URL is the server ORIGIN
 * (scheme + host + port, no path, no trailing slash). @spanlens/sdk reads it
 * and appends the provider route itself (`/proxy/openai/v1`, ...), the same
 * contract the MCP server uses. Anything after the origin is dropped here so
 * a pasted proxy URL (`https://host/proxy/openai/v1`) or a stray trailing
 * slash cannot produce `https://host/proxy/openai/v1/proxy/openai/v1`.
 */

export type ServerUrlResult =
  | { ok: true; origin: string; droppedPath: string | null }
  | { ok: false; error: string }

export function normalizeServerUrl(raw: string): ServerUrlResult {
  const trimmed = raw.trim()
  if (trimmed === '') return { ok: false, error: 'The --server-url value is empty.' }
  if (!/^https?:\/\//i.test(trimmed)) {
    return {
      ok: false,
      error: `--server-url must start with http:// or https:// (got "${trimmed}").`,
    }
  }

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return { ok: false, error: `--server-url is not a valid URL (got "${trimmed}").` }
  }
  if (url.username || url.password) {
    return { ok: false, error: 'Leave the username and password out of --server-url.' }
  }

  const path = /^\/*$/.test(url.pathname) ? '' : url.pathname
  const dropped = `${path}${url.search}${url.hash}`
  return { ok: true, origin: url.origin, droppedPath: dropped === '' ? null : dropped }
}

export interface ProxyEndpoint {
  provider: Provider
  url: string
}

/** The address each SDK factory sends requests to for a given server origin. */
export function proxyEndpoints(origin: string, providers: readonly Provider[]): ProxyEndpoint[] {
  return providers.map((provider) => ({ provider, url: `${origin}${PROVIDER_CONFIGS[provider].proxyPath}` }))
}
