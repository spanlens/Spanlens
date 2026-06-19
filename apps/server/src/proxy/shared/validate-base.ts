import { validateOutboundUrlSync } from '../../lib/safe-url.js'

/**
 * SSRF guard for operator-supplied `*_API_BASE` overrides.
 *
 * The OpenAI / OpenRouter / Mistral proxies allow the upstream host to be
 * overridden via an env var (so E2E can point at a local mock). That value is
 * concatenated straight into the upstream URL and the customer's decrypted
 * provider key is sent there, so a misconfigured or injected base
 * (e.g. http://169.254.169.254) would exfiltrate credentials to an internal
 * target. Validate the override at module load and fail fast instead of
 * forwarding keys.
 *
 * Only enforced in production: `validateOutboundUrlSync` requires https, which
 * would reject the documented dev/E2E mock at http://localhost:4000. Defaults
 * (the unset case) are trusted constants and are never validated.
 *
 * @param envVarName the env var that may carry an override (e.g. 'OPENAI_API_BASE')
 * @param base the resolved base URL actually used by the proxy
 */
export function assertSafeProxyBase(envVarName: string, base: string): void {
  if (process.env['NODE_ENV'] !== 'production') return
  // Only validate when the operator actually set an override; the built-in
  // default is a known-safe constant.
  if (!process.env[envVarName]) return

  const result = validateOutboundUrlSync(base)
  if (!result.ok) {
    throw new Error(
      `${envVarName} rejected by SSRF guard: ${result.message} (value: ${base})`,
    )
  }
}
