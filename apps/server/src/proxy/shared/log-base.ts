/**
 * Construct the `logBase` object passed to logRequestAsync / log*Stream.
 *
 * Each proxy previously duplicated the same 18-field literal. Centralising
 * means new log fields (e.g. additional X-Spanlens-* identifiers) land in
 * one file instead of four, and a future schema change (rename, add
 * required field) cannot drift between providers.
 */

import type { Context } from 'hono'
import { parseLogBodyMode } from '../../lib/logger.js'
import { resolvePromptVersion } from '../../lib/resolve-prompt-version.js'
import type { SecurityFlag } from '../../lib/security-scan.js'
import type { ResolvedProviderKey } from '../utils.js'
import type { ProxyProvider } from './provider-key.js'

export interface ProxyLogBase {
  organizationId: string
  projectId: string
  apiKeyId: string
  provider: ProxyProvider
  latencyMs: number
  proxyOverheadMs: number
  statusCode: number
  requestBody: Record<string, unknown> | null
  responseBody: null
  errorMessage: null
  traceId: string | null
  spanId: string | null
  promptVersionId: string | null
  providerKeyId: string
  userId: string | null
  sessionId: string | null
  logBodyMode: ReturnType<typeof parseLogBodyMode>
  preComputedRequestFlags: SecurityFlag[]
}

export interface BuildLogBaseInput {
  c: Context
  provider: ProxyProvider
  organizationId: string
  projectId: string
  apiKeyId: string
  providerKey: ResolvedProviderKey
  reqBodyJson: Record<string, unknown> | null
  requestFlags: SecurityFlag[]
  latencyMs: number
  proxyOverheadMs: number
  statusCode: number
}

export async function buildLogBase(input: BuildLogBaseInput): Promise<ProxyLogBase> {
  const traceId = input.c.req.header('x-trace-id') ?? null
  const resolved = await resolvePromptVersion(
    input.organizationId,
    input.c.req.header('x-spanlens-prompt-version') ?? null,
    traceId,
  )
  return {
    organizationId: input.organizationId,
    projectId: input.projectId,
    apiKeyId: input.apiKeyId,
    provider: input.provider,
    latencyMs: input.latencyMs,
    proxyOverheadMs: input.proxyOverheadMs,
    statusCode: input.statusCode,
    requestBody: input.reqBodyJson,
    responseBody: null,
    errorMessage: null,
    traceId,
    spanId: input.c.req.header('x-span-id') ?? null,
    promptVersionId: resolved?.versionId ?? null,
    providerKeyId: input.providerKey.id,
    userId: input.c.req.header('x-spanlens-user') ?? null,
    sessionId: input.c.req.header('x-spanlens-session') ?? null,
    logBodyMode: parseLogBodyMode(input.c.req.header('x-spanlens-log-body')),
    preComputedRequestFlags: input.requestFlags,
  }
}
