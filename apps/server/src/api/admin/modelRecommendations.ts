import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../../middleware/authJwt.js'
import { requireSystemAdmin } from '../../middleware/requireSystemAdmin.js'
import { supabaseAdmin } from '../../lib/db.js'
import { refreshRulesNow } from '../../lib/model-recommendations-cache.js'
import { parsePositiveInt } from '../../lib/params.js'
import { ApiError } from '../../lib/errors.js'

/**
 * Admin-only CRUD for `model_recommendations` substitute rules (P3.3).
 *
 *   GET    /api/v1/admin/model-recommendations         list all
 *   POST   /api/v1/admin/model-recommendations         upsert (current_provider+current_model)
 *   DELETE /api/v1/admin/model-recommendations/:id     remove
 *
 * After every mutation the in-memory cache is refreshed so the next request
 * sees the new rule on THIS function instance. Other Vercel instances pick
 * up the change within their own 5-min TTL.
 *
 * Authorization: SPANLENS_ADMIN_EMAILS env var (see requireSystemAdmin).
 * Same pattern as `/api/v1/admin/model-prices` from P2.1.
 */
export const adminModelRecommendationsRouter = new Hono<JwtContext>()

adminModelRecommendationsRouter.use('*', authJwt)
adminModelRecommendationsRouter.use('*', requireSystemAdmin)

const ALLOWED_PROVIDERS = new Set(['openai', 'anthropic', 'gemini'])

interface UpsertInput {
  current_provider: 'openai' | 'anthropic' | 'gemini'
  current_model: string
  suggested_provider: 'openai' | 'anthropic' | 'gemini'
  suggested_model: string
  cost_ratio: number
  max_avg_prompt_tokens: number
  max_avg_completion_tokens: number
  reason: string
}

function parseUpsert(body: unknown): { ok: true; data: UpsertInput } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Body must be an object' }
  const b = body as Record<string, unknown>

  const stringFields: Array<{ key: keyof UpsertInput; max?: number }> = [
    { key: 'current_model', max: 200 },
    { key: 'suggested_model', max: 200 },
    { key: 'reason', max: 2000 },
  ]
  for (const { key, max = 500 } of stringFields) {
    const v = b[key]
    if (typeof v !== 'string' || v.length === 0 || v.length > max) {
      return { ok: false, error: `${key} must be a non-empty string ≤ ${max} chars` }
    }
  }

  for (const k of ['current_provider', 'suggested_provider'] as const) {
    if (typeof b[k] !== 'string' || !ALLOWED_PROVIDERS.has(b[k] as string)) {
      return { ok: false, error: `${k} must be one of openai|anthropic|gemini` }
    }
  }

  const numFields: Array<{ key: keyof UpsertInput; positive?: boolean; integer?: boolean }> = [
    { key: 'cost_ratio', positive: true },
    { key: 'max_avg_prompt_tokens', positive: true, integer: true },
    { key: 'max_avg_completion_tokens', positive: true, integer: true },
  ]
  for (const { key, positive, integer } of numFields) {
    const v = b[key]
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      return { ok: false, error: `${key} must be a finite number` }
    }
    if (positive && v <= 0) return { ok: false, error: `${key} must be > 0` }
    if (integer && !Number.isInteger(v)) return { ok: false, error: `${key} must be an integer` }
  }

  return {
    ok: true,
    data: {
      current_provider: b['current_provider'] as UpsertInput['current_provider'],
      current_model: b['current_model'] as string,
      suggested_provider: b['suggested_provider'] as UpsertInput['suggested_provider'],
      suggested_model: b['suggested_model'] as string,
      cost_ratio: b['cost_ratio'] as number,
      max_avg_prompt_tokens: b['max_avg_prompt_tokens'] as number,
      max_avg_completion_tokens: b['max_avg_completion_tokens'] as number,
      reason: b['reason'] as string,
    },
  }
}

adminModelRecommendationsRouter.get('/', async (c) => {
  // Allow paging in case the rule set grows (unlikely > 50 for a long time).
  const limit = Math.min(parsePositiveInt(c.req.query('limit'), 200), 500)
  const offset = parsePositiveInt(c.req.query('offset'), 0)

  const { data, error, count } = await supabaseAdmin
    .from('model_recommendations')
    .select(
      'id, current_provider, current_model, suggested_provider, suggested_model, ' +
      'cost_ratio, max_avg_prompt_tokens, max_avg_completion_tokens, reason, ' +
      'effective_from, created_at, updated_at',
      { count: 'exact' },
    )
    .order('current_provider', { ascending: true })
    .order('current_model', { ascending: true })
    .range(offset, offset + limit - 1)

  if (error) throw new ApiError('INTERNAL_ERROR', 'Failed to fetch recommendations')

  return c.json({
    success: true,
    data: data ?? [],
    meta: { total: count ?? 0, limit, offset },
  })
})

adminModelRecommendationsRouter.post('/', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json().catch(() => null)
  const parsed = parseUpsert(body)
  if (!parsed.ok) throw new ApiError('VALIDATION_FAILED', parsed.error)

  const row = {
    ...parsed.data,
    effective_from: new Date().toISOString(),
  }

  const { data, error } = await supabaseAdmin
    .from('model_recommendations')
    .upsert(row, { onConflict: 'current_provider,current_model' })
    .select()
    .single()

  if (error) return c.json({ error: `Upsert failed: ${error.message}` }, 500)

  // Make the new rule visible on this instance immediately. Others pick it up
  // within TTL (≤5 min).
  await refreshRulesNow()

  const orgId = c.get('orgId')
  if (orgId && data) {
    await supabaseAdmin.from('audit_logs').insert({
      organization_id: orgId,
      user_id: userId,
      action: 'model_recommendation.upsert',
      resource_type: 'model_recommendation',
      resource_id: (data as { id: string }).id,
      metadata: {
        current: `${parsed.data.current_provider}:${parsed.data.current_model}`,
        suggested: `${parsed.data.suggested_provider}:${parsed.data.suggested_model}`,
        cost_ratio: parsed.data.cost_ratio,
      },
    })
  }

  return c.json({ success: true, data })
})

adminModelRecommendationsRouter.delete('/:id', async (c) => {
  const id = c.req.param('id')
  const userId = c.get('userId')

  const { error } = await supabaseAdmin
    .from('model_recommendations')
    .delete()
    .eq('id', id)

  if (error) return c.json({ error: `Delete failed: ${error.message}` }, 500)

  await refreshRulesNow()

  const orgId = c.get('orgId')
  if (orgId) {
    await supabaseAdmin.from('audit_logs').insert({
      organization_id: orgId,
      user_id: userId,
      action: 'model_recommendation.delete',
      resource_type: 'model_recommendation',
      resource_id: id,
    })
  }

  return c.json({ success: true })
})
