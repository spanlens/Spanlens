/**
 * MCP tool registrations.
 *
 * Each tool is a thin shim over a Spanlens REST endpoint. Input shapes use
 * zod so the MCP client can render parameter docs and validate calls before
 * they hit the network. Output is always returned as a single text block —
 * MCP clients render JSON well enough that structured output isn't needed yet.
 *
 * Why all 7 in one file: they're each ~20 lines and they all share the same
 * `SpanlensClient` + `formatJson` helper. Splitting into 7 files would just
 * add noise without making any single tool easier to find. Revisit if the
 * surface grows past ~10 tools.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { SpanlensClient } from './client.js'

const formatJson = (data: unknown): { content: Array<{ type: 'text'; text: string }> } => ({
  content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
})

const formatError = (
  err: unknown,
): { content: Array<{ type: 'text'; text: string }>; isError: true } => {
  const msg = err instanceof Error ? err.message : String(err)
  return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true }
}

/**
 * Translate the MCP-friendly timeframe enum into hours.
 *
 * The REST API has no `window` param: /stats/overview takes `from`/`to`
 * ISO dates and /stats/models takes `hours`. (v0.2.0 sent `window`, which
 * the server silently ignored — stats came back for the wrong period.)
 */
export function timeframeToHours(tf?: string): number {
  switch (tf) {
    case '1h':
      return 1
    case '24h':
      return 24
    case '30d':
      return 30 * 24
    case '7d':
    default:
      return 7 * 24
  }
}

/** ISO timestamp `hours` ago — the `from` bound for /stats/overview. */
export function hoursAgoIso(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString()
}

/**
 * Map an ISO `since` bound onto /api/v1/anomalies' `observationHours`
 * param (the server compares the last N hours against a reference window;
 * it has no `from` param). Clamped to the server's accepted 0.25–72 range.
 */
export function sinceToObservationHours(since: string): number | undefined {
  const t = Date.parse(since)
  if (Number.isNaN(t)) return undefined
  const hours = (Date.now() - t) / 3_600_000
  return Math.min(72, Math.max(0.25, hours))
}

export function registerTools(server: McpServer, client: SpanlensClient): void {
  // ── 1. get_stats ────────────────────────────────────────────────────────
  server.tool(
    'get_stats',
    'Get aggregate LLM cost, request count, latency, and error-rate stats for the workspace. Use when the user asks about spend, usage volume, or how things have been going.',
    {
      timeframe: z
        .enum(['1h', '24h', '7d', '30d'])
        .optional()
        .describe("Time window. Default '7d'."),
      groupBy: z
        .enum(['model', 'provider'])
        .optional()
        .describe(
          "When set, returns per-group breakdown from /stats/models instead of overview totals.",
        ),
    },
    async ({ timeframe, groupBy }) => {
      try {
        const hours = timeframeToHours(timeframe)
        if (groupBy === 'model' || groupBy === 'provider') {
          const data = await client.get('/api/v1/stats/models', { hours })
          return formatJson(data)
        }
        const data = await client.get('/api/v1/stats/overview', {
          from: hoursAgoIso(hours),
        })
        return formatJson(data)
      } catch (err) {
        return formatError(err)
      }
    },
  )

  // ── 2. query_requests ───────────────────────────────────────────────────
  server.tool(
    'query_requests',
    'List individual LLM requests with cost, latency, model, status, and error message. Use when the user wants to see specific calls — recent ones, errors only, particular model, particular user, etc.',
    {
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe('Max rows to return. Default 20, max 100.'),
      model: z.string().optional().describe('Filter to a specific model substring.'),
      provider: z
        .enum([
          'openai',
          'anthropic',
          'gemini',
          'azure',
          'mistral',
          'openrouter',
          'groq',
          'deepseek',
          'xai',
          'cohere',
        ])
        .optional()
        .describe('Filter to a specific provider.'),
      status: z
        .enum(['success', 'error'])
        .optional()
        .describe('Filter by overall status — success (2xx) or error (4xx/5xx).'),
      userId: z
        .string()
        .optional()
        .describe(
          'Filter to a specific end-user (the value the customer attaches via x-spanlens-user).',
        ),
      since: z
        .string()
        .optional()
        .describe(
          'ISO 8601 timestamp lower bound. Only return requests created at or after this time.',
        ),
    },
    async ({ limit, model, provider, status, userId, since }) => {
      try {
        const data = await client.get('/api/v1/requests', {
          limit: limit ?? 20,
          model,
          provider,
          status,
          userId,
          from: since,
        })
        return formatJson(data)
      } catch (err) {
        return formatError(err)
      }
    },
  )

  // ── 3. list_traces ──────────────────────────────────────────────────────
  // Closes the discovery loop for get_trace — without this, a user has to
  // know a trace UUID from elsewhere before they can pull the span tree.
  // The most common workflow ("show me my agent runs and let me drill in")
  // needs both tools.
  server.tool(
    'list_traces',
    'List agent traces with optional filters. Use to discover trace IDs to feed into get_trace, or to scan recent agent runs. Returns trace summaries (name, status, duration, span count, total tokens, total cost). Does NOT include individual span data — call get_trace with a trace ID for that.',
    {
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe('Max traces to return. Default 20, max 100.'),
      status: z
        .enum(['running', 'completed', 'error'])
        .optional()
        .describe('Filter by trace status.'),
      since: z
        .string()
        .optional()
        .describe('ISO 8601 lower bound on `started_at`. Only return traces that started at or after this time.'),
      query: z
        .string()
        .optional()
        .describe('Substring match on trace name or trace id.'),
    },
    async ({ limit, status, since, query }) => {
      try {
        const data = await client.get('/api/v1/traces', {
          limit: limit ?? 20,
          status,
          from: since,
          q: query,
        })
        return formatJson(data)
      } catch (err) {
        return formatError(err)
      }
    },
  )

  // ── 4. get_trace ────────────────────────────────────────────────────────
  server.tool(
    'get_trace',
    'Fetch the full span tree for a single agent trace by id — every llm/tool/retrieval span with timing, tokens, and cost. Use when the user names a trace, asks why one was slow, or asks what an agent did step by step. Pair with list_traces if you need to discover the trace id first.',
    {
      traceId: z.string().describe('UUID of the trace.'),
    },
    async ({ traceId }) => {
      try {
        const data = await client.get(`/api/v1/traces/${encodeURIComponent(traceId)}`)
        return formatJson(data)
      } catch (err) {
        return formatError(err)
      }
    },
  )

  // ── 5. get_anomalies ────────────────────────────────────────────────────
  server.tool(
    'get_anomalies',
    'List unacknowledged cost / latency / error-rate anomalies the platform has detected. Each anomaly carries a `deviations` field (how many sigmas off baseline). Use when the user asks "anything weird going on?", "any spikes?", or wants a quick health check.',
    {
      since: z
        .string()
        .optional()
        .describe(
          'ISO 8601 timestamp. Sets the observation window: behaviour since this time is compared against the preceding baseline. Clamped to the last 15 minutes – 72 hours; default is the last hour.',
        ),
      sigma: z
        .number()
        .min(1)
        .max(10)
        .optional()
        .describe('Minimum deviations (in sigmas) to flag. Default 3. Lower = more sensitive.'),
    },
    async ({ since, sigma }) => {
      try {
        const data = await client.get('/api/v1/anomalies', {
          observationHours: since ? sinceToObservationHours(since) : undefined,
          sigma,
        })
        return formatJson(data)
      } catch (err) {
        return formatError(err)
      }
    },
  )

  // ── 6. get_savings ──────────────────────────────────────────────────────
  server.tool(
    'get_savings',
    'List model-swap recommendations the platform thinks would save money without losing quality. Each item carries projected monthly savings, prior-window cost, and an `achieved` flag if the swap has already been adopted.',
    {
      hours: z
        .number()
        .int()
        .min(1)
        .max(720)
        .optional()
        .describe(
          'Analysis window in hours. Default 168 (7 days). Longer = more confident, but slower.',
        ),
      minSavings: z
        .number()
        .nonnegative()
        .optional()
        .describe('Only return recommendations projecting at least this many USD/month in savings.'),
    },
    async ({ hours, minSavings }) => {
      try {
        const data = await client.get('/api/v1/recommendations', { hours, minSavings })
        return formatJson(data)
      } catch (err) {
        return formatError(err)
      }
    },
  )

  // ── 7. get_user_analytics ──────────────────────────────────────────────
  server.tool(
    'get_user_analytics',
    "Get per-end-user usage breakdown — total requests, cost, latency, models used, recent calls. The 'user' here is the customer's end-user, identified by the `x-spanlens-user` header the SDK attaches.",
    {
      userId: z
        .string()
        .optional()
        .describe(
          'When set, returns the detail view for a single end-user. When omitted, returns the top-N usage list across all end-users.',
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe('Max rows when returning the top-N list. Default 20.'),
    },
    async ({ userId, limit }) => {
      try {
        if (userId) {
          const data = await client.get(`/api/v1/users/${encodeURIComponent(userId)}`)
          return formatJson(data)
        }
        const data = await client.get('/api/v1/users', { limit: limit ?? 20 })
        return formatJson(data)
      } catch (err) {
        return formatError(err)
      }
    },
  )
}
