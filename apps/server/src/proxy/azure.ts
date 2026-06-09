import { Hono } from 'hono'
import { stream } from 'hono/streaming'
import { authApiKey, type ApiKeyContext } from '../middleware/authApiKey.js'
import { requireFullScope } from '../middleware/requireFullScope.js'
import { enforceQuota } from '../middleware/quota.js'
import { proxyRateLimit } from '../middleware/rateLimit.js'
import { calculateCost } from '../lib/cost.js'
import { logRequestAsync, parseLogBodyMode } from '../lib/logger.js'
import { resolvePromptVersion } from '../lib/resolve-prompt-version.js'
import { fireAndForget } from '../lib/wait-until.js'
import { parseOpenAIResponse } from '../parsers/openai.js'
import { scanAll } from '../lib/security-scan.js'
import { getDecryptedProviderKey, buildUpstreamHeaders, buildDownstreamHeaders, isBlockingEnabled } from './utils.js'
import { logOpenAIStream } from './stream-logger.js'
import { cancelReaderSilently, makeStreamDeadline, readWithDeadline } from './stream-deadline.js'
import { ApiError } from '../lib/errors.js'

// Azure OpenAI v1 endpoint (Microsoft, Aug 2025+). Drop-in compatible with
// OpenAI request/response shape — no api-version query, no per-deployment
// URL fragments. Customer's resource origin lives on provider_keys.provider_metadata.resource_url.
//
// Request flow:
//   client → POST /proxy/azure/chat/completions
//          → upstream POST {resource_url}/openai/v1/chat/completions
//
// Differences vs. /proxy/openai:
//   - Base URL is per-key (Azure resource), not a constant
//   - Auth header: api-key (not Authorization: Bearer)
//   - Response includes Azure-only fields (prompt_filter_results, content_filter_results,
//     system_fingerprint) — OpenAI parser ignores unknown fields, so passthrough works
const UPSTREAM_TIMEOUT_MS = parseInt(process.env['UPSTREAM_TIMEOUT_MS'] ?? '35000', 10)

export const azureProxy = new Hono<ApiKeyContext>()

azureProxy.use('*', authApiKey)
azureProxy.use('*', requireFullScope)
azureProxy.use('*', proxyRateLimit)
azureProxy.use('*', enforceQuota)

azureProxy.all('/*', async (c) => {
  const handlerStartMs = Date.now()

  const organizationId = c.get('organizationId')
  // Narrowing: requireFullScope + DB CHECK constraint guarantee non-null. See openai.ts.
  const projectId = c.get('projectId') as string
  const apiKeyId = c.get('apiKeyId')

  const providerKey = await getDecryptedProviderKey(apiKeyId, 'azure')
  if (!providerKey) {
    throw new ApiError('NO_PROVIDER_KEY', 'No active Azure provider key registered for this Spanlens key')
  }
  const decryptedKey = providerKey.plaintext

  // resource_url is enforced NOT NULL at the DB layer for 'azure' rows
  // (provider_keys_azure_requires_resource_url CHECK constraint).
  // Defensive empty-string fallback only triggers if a future migration
  // removes the constraint — surface a clear 500 rather than build a
  // malformed upstream URL.
  const resourceUrl = (providerKey.metadata['resource_url'] as string | undefined) ?? ''
  if (resourceUrl.length === 0) {
    console.error('[azure-proxy] provider_key missing resource_url:', providerKey.id)
    throw new ApiError('INTERNAL_ERROR', 'Azure provider key is missing resource_url — re-register it')
  }

  const reqBodyText = await c.req.text()
  let reqBodyJson: Record<string, unknown> | null = null
  let isStreaming = false

  try {
    reqBodyJson = JSON.parse(reqBodyText) as Record<string, unknown>
    isStreaming = reqBodyJson.stream === true

    if (isStreaming) {
      reqBodyJson = {
        ...reqBodyJson,
        stream_options: { include_usage: true },
      }
    }
  } catch { /* non-JSON body — pass through */ }

  // ── Security scan + blocking ───────────────────────────────────────────────
  const requestFlags = scanAll(reqBodyJson)
  const hasInjection = requestFlags.some((f) => f.type === 'injection')
  if (hasInjection && await isBlockingEnabled(projectId)) {
    throw new ApiError(
      'INJECTION_BLOCKED',
      'Request blocked by Spanlens security policy: prompt injection detected.',
    )
  }

  const path = c.req.path.replace(/^\/proxy\/azure/, '')
  const upstreamUrl = `${resourceUrl}/openai/v1${path}`

  // Azure uses `api-key` (not Authorization Bearer). Strip authorization
  // explicitly in case some client lib retransmits one.
  const headers = buildUpstreamHeaders(c.req.raw.headers, {
    'api-key': decryptedKey,
    'Content-Type': 'application/json',
  })
  headers.delete('authorization')

  const startMs = Date.now()
  const fetchBody =
    c.req.method !== 'GET' && c.req.method !== 'HEAD'
      ? isStreaming && reqBodyJson ? JSON.stringify(reqBodyJson) : reqBodyText
      : null

  const upstreamAbort = new AbortController()
  const upstreamTimer = setTimeout(() => upstreamAbort.abort(), UPSTREAM_TIMEOUT_MS)
  let upstreamRes: Response
  try {
    upstreamRes = await fetch(upstreamUrl, { method: c.req.method, headers, body: fetchBody, signal: upstreamAbort.signal })
  } catch (err) {
    clearTimeout(upstreamTimer)
    const msg = err instanceof Error ? err.message : 'Unknown error'
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ApiError('UPSTREAM_TIMEOUT', `Upstream request timed out after ${UPSTREAM_TIMEOUT_MS}ms`)
    }
    console.error('[azure-proxy] upstream fetch error:', msg)
    throw new ApiError('UPSTREAM_FAILED', `Upstream request failed: ${msg}`)
  }
  clearTimeout(upstreamTimer)
  const latencyMs = Date.now() - startMs
  const proxyOverheadMs = startMs - handlerStartMs

  const model = (reqBodyJson?.model as string | undefined) ?? ''
  const traceId = c.req.header('x-trace-id') ?? null
  const resolved = await resolvePromptVersion(
    organizationId,
    c.req.header('x-spanlens-prompt-version') ?? null,
    traceId,
  )
  const promptVersionId = resolved?.versionId ?? null
  const logBase = {
    organizationId, projectId, apiKeyId,
    provider: 'azure',
    latencyMs, proxyOverheadMs, statusCode: upstreamRes.status,
    requestBody: reqBodyJson,
    responseBody: null,
    errorMessage: null,
    traceId,
    spanId: c.req.header('x-span-id') ?? null,
    promptVersionId,
    providerKeyId: providerKey.id,
    userId: c.req.header('x-spanlens-user') ?? null,
    sessionId: c.req.header('x-spanlens-session') ?? null,
    logBodyMode: parseLogBodyMode(c.req.header('x-spanlens-log-body')),
    preComputedRequestFlags: requestFlags,
  }

  // ── Streaming path ────────────────────────────────────────────────────────
  if (isStreaming && upstreamRes.body) {
    const downstreamHeaders = buildDownstreamHeaders(upstreamRes.headers)
    downstreamHeaders.forEach((value, key) => c.header(key, value))
    c.status(upstreamRes.status as 200)

    const upstreamBody = upstreamRes.body

    return stream(c, async (honoStream) => {
      const reader = upstreamBody.getReader()
      const decoder = new TextDecoder()
      const deadline = makeStreamDeadline(handlerStartMs)
      let buffer = ''
      const lines: string[] = []
      let truncated = false

      pump: for (;;) {
        const outcome = await readWithDeadline(reader, deadline)
        switch (outcome.kind) {
          case 'done':
            break pump
          case 'timeout':
            truncated = true
            console.warn('[azure-stream] deadline reached, closing gracefully')
            await cancelReaderSilently(reader)
            break pump
          case 'error':
            console.error('[azure-stream] reader error:', outcome.error)
            break pump
          case 'chunk': {
            await honoStream.write(outcome.value)
            buffer += decoder.decode(outcome.value, { stream: true })
            const parts = buffer.split('\n')
            buffer = parts.pop() ?? ''
            lines.push(...parts)
            break
          }
        }
      }
      if (buffer.length > 0) lines.push(buffer)

      // Azure SSE chunk shape is OpenAI-compatible — same parser works.
      // The 'azure' provider tag on logBase is what flows into ClickHouse,
      // not what the parser cares about.
      await logOpenAIStream(lines, { ...logBase, model }, { truncated }).catch((err) => {
        console.error('[azure-stream] log error:', err)
      })
    })
  }

  // ── Non-streaming path ────────────────────────────────────────────────────
  const downstreamHeaders = buildDownstreamHeaders(upstreamRes.headers)
  const resBodyText = await upstreamRes.text()
  let resBodyJson: unknown = null
  try { resBodyJson = JSON.parse(resBodyText) } catch { /* non-JSON response */ }

  let promptTokens = 0
  let completionTokens = 0
  let totalTokens = 0
  let cacheReadTokens = 0
  let cacheWriteTokens = 0
  let resolvedModel = model
  let serviceTier: import('../parsers/openai.js').ServiceTier | undefined

  if (upstreamRes.ok && resBodyJson) {
    try {
      const parsed = parseOpenAIResponse(resBodyJson as Record<string, unknown>)
      if (parsed) {
        resolvedModel = parsed.model || model
        promptTokens = parsed.promptTokens
        completionTokens = parsed.completionTokens
        totalTokens = parsed.totalTokens
        cacheReadTokens = parsed.cacheReadTokens ?? 0
        cacheWriteTokens = parsed.cacheWriteTokens ?? 0
        serviceTier = parsed.serviceTier
      }
    } catch { /* ignore */ }
  }

  // Azure exposes OpenAI models at OpenAI prices — reuse the OpenAI price
  // table rather than maintaining a parallel one. If a customer deploys a
  // model under a custom deployment name that doesn't match a known model
  // key, lookupPrice() returns null and cost_usd ends up NULL (existing
  // behavior, no regression).
  const cost = calculateCost('openai', resolvedModel, {
    promptTokens, completionTokens, cacheReadTokens, cacheWriteTokens, serviceTier,
  })

  fireAndForget(c, logRequestAsync({
    ...logBase,
    model: resolvedModel,
    promptTokens, completionTokens, totalTokens,
    cacheReadTokens, cacheWriteTokens,
    serviceTier: serviceTier ?? null,
    costUsd: cost?.totalCost ?? null,
    responseBody: resBodyJson,
    errorMessage: upstreamRes.ok ? null : resBodyText.slice(0, 1000),
  }))

  return new Response(resBodyText, { status: upstreamRes.status, headers: downstreamHeaders })
})
