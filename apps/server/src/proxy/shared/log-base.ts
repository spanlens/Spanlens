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
  /**
   * Raw X-Spanlens-Prompt-Version header, resolved to promptVersionId later
   * inside logRequestAsync (off the response-critical path). buildLogBase no
   * longer resolves it: on a cold prompt cache the resolve does 1-2 Supabase
   * queries, and doing that here delayed time-to-first-token on streaming
   * requests even though the id is only needed for the deferred log write.
   */
  promptVersionHeader: string | null
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

// `x-trace-id` / `x-span-id` are customer-supplied headers, and the columns
// they land in are `text`, so anything at all would store. They are only
// useful as a join key against `traces.id` / `spans.id`, which are `uuid`, so
// a value that is not a UUID can never match a trace and would sit in the row
// looking like a grouping key that simply never resolves. Coerce those to
// null instead: "not traced" is a state the dashboard renders honestly.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isUuid(value: string): boolean {
  return UUID_RE.test(value)
}

function uuidHeaderOrNull(value: string | undefined): string | null {
  return value && isUuid(value) ? value : null
}

export function buildLogBase(input: BuildLogBaseInput): ProxyLogBase {
  const traceId = uuidHeaderOrNull(input.c.req.header('x-trace-id'))
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
    spanId: uuidHeaderOrNull(input.c.req.header('x-span-id')),
    promptVersionId: null,
    promptVersionHeader: input.c.req.header('x-spanlens-prompt-version') ?? null,
    providerKeyId: input.providerKey.id,
    userId: input.c.req.header('x-spanlens-user') ?? null,
    sessionId: input.c.req.header('x-spanlens-session') ?? null,
    logBodyMode: parseLogBodyMode(input.c.req.header('x-spanlens-log-body')),
    preComputedRequestFlags: input.requestFlags,
  }
}
