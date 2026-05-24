import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../middleware/authJwt.js'
import { supabaseAdmin } from '../lib/db.js'

/**
 * GET /api/v1/models — list of all priced models, grouped by provider.
 *
 * Why this exists:
 *   The Prompts → Playground tab used to hardcode a 12-entry list of model
 *   strings. After we expanded model_prices to 82 rows in PR #146, that
 *   list went stale and users couldn't pick GPT-5.x / Claude Opus 4.7 /
 *   Gemini 3.x. This endpoint reads model_prices directly so the UI stays
 *   in sync with whatever's been seeded.
 *
 * Filtering:
 *   - Skips models that look like dated snapshots when an alias exists for
 *     the same family (heuristic: ends in -YYYYMMDD or -YYYY-MM-DD). Dated
 *     variants stay billable but the picker shows the friendly alias.
 *     Customers can still hit them by passing the dated name in the
 *     request body — Playground UX just doesn't surface every snapshot.
 *
 * Auth: JWT (any signed-in user). Pricing is global — no org scoping.
 */
export const modelsRouter = new Hono<JwtContext>()

modelsRouter.use('*', authJwt)

interface ModelEntry {
  model: string
  promptPricePer1m: number
  completionPricePer1m: number
  cacheReadPricePer1m: number | null
  cacheWritePricePer1m: number | null
  /** Set when the model has a tiered long-context price. */
  longContextThresholdTokens: number | null
}

interface ModelsResponse {
  openai: ModelEntry[]
  anthropic: ModelEntry[]
  gemini: ModelEntry[]
}

const DATED_SUFFIX = /-\d{8}$|-\d{4}-\d{2}-\d{2}$/

function isDatedSnapshot(model: string): boolean {
  return DATED_SUFFIX.test(model)
}

modelsRouter.get('/', async (c) => {
  const { data, error } = await supabaseAdmin
    .from('model_prices')
    .select(
      'provider, model, prompt_price_per_1m, completion_price_per_1m,' +
      ' cache_read_price_per_1m, cache_write_price_per_1m,' +
      ' long_context_threshold_tokens',
    )
    .order('model', { ascending: true })

  if (error) {
    return c.json({ error: 'Failed to load models', detail: error.message }, 500)
  }

  const groups: ModelsResponse = { openai: [], anthropic: [], gemini: [] }

  for (const row of data ?? []) {
    const r = row as unknown as Record<string, unknown>
    const provider = r['provider'] as 'openai' | 'anthropic' | 'gemini'
    if (!groups[provider]) continue
    const model = r['model'] as string
    // Skip dated variants when an alias already exists — keeps the picker
    // readable while the row stays billable for direct API calls.
    if (isDatedSnapshot(model)) {
      const alias = model.replace(DATED_SUFFIX, '')
      const hasAlias = (data ?? []).some(
        (other) => (other as unknown as Record<string, unknown>)['model'] === alias,
      )
      if (hasAlias) continue
    }
    groups[provider].push({
      model,
      promptPricePer1m: Number(r['prompt_price_per_1m']),
      completionPricePer1m: Number(r['completion_price_per_1m']),
      cacheReadPricePer1m:
        r['cache_read_price_per_1m'] != null ? Number(r['cache_read_price_per_1m']) : null,
      cacheWritePricePer1m:
        r['cache_write_price_per_1m'] != null ? Number(r['cache_write_price_per_1m']) : null,
      longContextThresholdTokens:
        r['long_context_threshold_tokens'] != null
          ? Number(r['long_context_threshold_tokens'])
          : null,
    })
  }

  return c.json({ success: true, data: groups })
})
