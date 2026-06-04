import { createMiddleware } from 'hono/factory'
import type { ApiKeyContext } from './authApiKey.js'

/**
 * Rejects requests authenticated with a `public`-scope Spanlens key.
 *
 * Mounted on routes that perform writes or trigger spend:
 *   • /proxy/openai, /proxy/anthropic, /proxy/gemini, /proxy/azure  (LLM calls)
 *   • /ingest/*                                                      (SDK writes)
 *   • POST /v1/traces                                                (OTLP exports)
 *
 * Must run AFTER `authApiKey` (which populates `apiKeyScope` on the context).
 *
 * Public keys still work on:
 *   • /api/v1/stats/*, /api/v1/requests, /api/v1/traces (GET)
 *   • /api/v1/me/key-info                                (CLI introspection)
 *
 * Why a separate middleware vs. an inline check: the same guard applies to
 * 7+ routers and the check is identical. Centralising it keeps the rule
 * (which routes are "write") in one place and prevents accidental drift
 * when adding new proxy or ingest endpoints.
 */
export const requireFullScope = createMiddleware<ApiKeyContext>(async (c, next) => {
  const scope = c.get('apiKeyScope')
  if (scope === 'public') {
    return c.json(
      {
        error:
          'Public API key cannot perform write operations. Issue a full-access key on the Projects & Keys page to enable LLM proxy and ingest endpoints.',
        code: 'PUBLIC_KEY_WRITE_FORBIDDEN',
      },
      403,
    )
  }
  return next()
})
