import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../middleware/authJwt.js'
import { recommendModelSwaps } from '../lib/model-recommend.js'
import { getClickhouse, toClickhouseTimestamp } from '../lib/clickhouse.js'
import { requestsScope } from '../lib/requests-query.js'
import { parsePositiveFloat } from '../lib/params.js'

/**
 * GET /api/v1/recommendations
 *   ?hours=168        analysis window (default 7 days)
 *   ?minSavings=5     only return recommendations projecting ≥ USD savings / month
 *
 * Returns suggested cheaper model substitutions based on the org's request
 * patterns — avg prompt/completion tokens per (provider, model) bucket.
 * Each item also includes `achieved`, `priorWindowCostUsd`, and
 * `actualMonthlySavingsUsd` for models whose spend dropped ≥70% vs the
 * prior comparable window.
 *
 * GET /api/v1/recommendations/percentiles
 *   ?provider=openai  required
 *   ?model=gpt-4o     required (can be a dated variant)
 *   ?hours=168        analysis window (default 7 days)
 *
 * Returns P50/P95/P99 token distribution for the given model, used by the
 * Savings "Simulate" dialog to visualise how actual token usage compares to
 * the substitute envelope. Lazy-fetched only when the dialog opens.
 */

export const recommendationsRouter = new Hono<JwtContext>()

recommendationsRouter.use('*', authJwt)


// ── Shape returned by ClickHouse percentiles query (all numbers as strings) ───

interface PercentileRow {
  p50_prompt: string | null
  p95_prompt: string | null
  p99_prompt: string | null
  p50_completion: string | null
  p95_completion: string | null
  p99_completion: string | null
  sample_count: string
}

// ── Routes ───────────────────────────────────────────────────────────────────

recommendationsRouter.get('/', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const hours = parsePositiveFloat(c.req.query('hours'), 24 * 7)
  const minSavingsUsd = parsePositiveFloat(c.req.query('minSavings'), 5)

  const recommendations = await recommendModelSwaps(orgId, { hours, minSavingsUsd })
  return c.json({
    success: true,
    data: recommendations,
    meta: {
      hours,
      minSavingsUsd,
      count: recommendations.length,
    },
  })
})

recommendationsRouter.get('/percentiles', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const provider = c.req.query('provider')
  const model    = c.req.query('model')
  const hours    = parsePositiveFloat(c.req.query('hours'), 24 * 7)

  if (!provider || provider.length > 64) {
    return c.json({ error: 'provider is required (max 64 chars)' }, 400)
  }
  if (!model || model.length > 128) {
    return c.json({ error: 'model is required (max 128 chars)' }, 400)
  }

  const windowStart = new Date(Date.now() - hours * 3_600_000)
  const windowStartTs = toClickhouseTimestamp(windowStart)

  const scope = await requestsScope(orgId, { ignoreRetention: true })

  let row: PercentileRow | null = null
  try {
    const res = await getClickhouse().query({
      query: `
        SELECT
          quantile(0.50)(prompt_tokens)     AS p50_prompt,
          quantile(0.95)(prompt_tokens)     AS p95_prompt,
          quantile(0.99)(prompt_tokens)     AS p99_prompt,
          quantile(0.50)(completion_tokens) AS p50_completion,
          quantile(0.95)(completion_tokens) AS p95_completion,
          quantile(0.99)(completion_tokens) AS p99_completion,
          count()                           AS sample_count
        FROM requests
        WHERE ${scope.whereScope}
          AND provider = {provider:String}
          AND (model = {model:String} OR startsWith(model, {modelPrefix:String}))
          AND created_at >= parseDateTime64BestEffort({windowStart:String})
          AND status_code IN (200, 201, 202, 204)
          AND prompt_tokens     > 0
          AND completion_tokens > 0
      `,
      query_params: {
        ...scope.scopeParams,
        provider,
        model,
        modelPrefix: model + '-',
        windowStart: windowStartTs,
      },
      format: 'JSONEachRow',
    })
    const rows = await res.json<PercentileRow>()
    row = rows[0] ?? null
  } catch (err) {
    return c.json({ error: String(err) }, 500)
  }

  const sampleCount = row ? Number(row.sample_count) : 0

  if (!row || sampleCount === 0) {
    return c.json({ success: true, data: null })
  }

  return c.json({
    success: true,
    data: {
      p50PromptTokens:      Math.round(Number(row.p50_prompt      ?? 0)),
      p95PromptTokens:      Math.round(Number(row.p95_prompt      ?? 0)),
      p99PromptTokens:      Math.round(Number(row.p99_prompt      ?? 0)),
      p50CompletionTokens:  Math.round(Number(row.p50_completion  ?? 0)),
      p95CompletionTokens:  Math.round(Number(row.p95_completion  ?? 0)),
      p99CompletionTokens:  Math.round(Number(row.p99_completion  ?? 0)),
      sampleCount,
    },
  })
})
