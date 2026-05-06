import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../middleware/authJwt.js'
import { recommendModelSwaps } from '../lib/model-recommend.js'
import { supabaseAdmin } from '../lib/db.js'

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

function parsePositive(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

// ── Shape returned by get_model_percentiles() ────────────────────────────────

interface PercentileRow {
  p50_prompt: number | null
  p95_prompt: number | null
  p99_prompt: number | null
  p50_completion: number | null
  p95_completion: number | null
  p99_completion: number | null
  sample_count: number | string  // Postgres bigint → string in some drivers
}

// ── Routes ───────────────────────────────────────────────────────────────────

recommendationsRouter.get('/', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const hours = parsePositive(c.req.query('hours'), 24 * 7)
  const minSavingsUsd = parsePositive(c.req.query('minSavings'), 5)

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
  const hours    = parsePositive(c.req.query('hours'), 24 * 7)

  if (!provider || provider.length > 64) {
    return c.json({ error: 'provider is required (max 64 chars)' }, 400)
  }
  if (!model || model.length > 128) {
    return c.json({ error: 'model is required (max 128 chars)' }, 400)
  }

  const windowStart = new Date(Date.now() - hours * 3_600_000).toISOString()

  const { data, error } = await supabaseAdmin.rpc('get_model_percentiles', {
    p_organization_id: orgId,
    p_provider: provider,
    p_model: model,
    p_window_start: windowStart,
  })

  if (error) return c.json({ error: error.message }, 500)

  const row = (data as PercentileRow[] | null)?.[0] ?? null
  const sampleCount = row ? Number(row.sample_count) : 0

  if (!row || sampleCount === 0) {
    return c.json({ success: true, data: null })
  }

  return c.json({
    success: true,
    data: {
      p50PromptTokens:      Math.round(row.p50_prompt      ?? 0),
      p95PromptTokens:      Math.round(row.p95_prompt      ?? 0),
      p99PromptTokens:      Math.round(row.p99_prompt      ?? 0),
      p50CompletionTokens:  Math.round(row.p50_completion  ?? 0),
      p95CompletionTokens:  Math.round(row.p95_completion  ?? 0),
      p99CompletionTokens:  Math.round(row.p99_completion  ?? 0),
      sampleCount,
    },
  })
})
