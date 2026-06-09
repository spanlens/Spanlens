import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../../middleware/authJwt.js'
import { requireSystemAdmin } from '../../middleware/requireSystemAdmin.js'
import { supabaseAdmin } from '../../lib/db.js'
import { refreshPricesNow } from '../../lib/model-prices-cache.js'
import { parsePositiveInt } from '../../lib/params.js'
import { ApiError } from '../../lib/errors.js'

const ALLOWED_PROVIDERS = new Set(['openai', 'anthropic', 'gemini'])

interface UpsertInput {
  provider: 'openai' | 'anthropic' | 'gemini'
  model: string
  prompt_price_per_1m: number
  completion_price_per_1m: number
  cache_read_price_per_1m: number | null
  cache_write_price_per_1m: number | null
}

function parseUpsert(body: unknown): { ok: true; data: UpsertInput } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Body must be an object' }
  const b = body as Record<string, unknown>

  if (typeof b['provider'] !== 'string' || !ALLOWED_PROVIDERS.has(b['provider'])) {
    return { ok: false, error: 'provider must be one of openai|anthropic|gemini' }
  }
  if (typeof b['model'] !== 'string' || b['model'].length === 0 || b['model'].length > 200) {
    return { ok: false, error: 'model must be a non-empty string ≤ 200 chars' }
  }
  if (typeof b['prompt_price_per_1m'] !== 'number' || b['prompt_price_per_1m'] < 0 || !Number.isFinite(b['prompt_price_per_1m'])) {
    return { ok: false, error: 'prompt_price_per_1m must be a non-negative finite number' }
  }
  if (typeof b['completion_price_per_1m'] !== 'number' || b['completion_price_per_1m'] < 0 || !Number.isFinite(b['completion_price_per_1m'])) {
    return { ok: false, error: 'completion_price_per_1m must be a non-negative finite number' }
  }

  const cacheRead = b['cache_read_price_per_1m']
  if (cacheRead != null && (typeof cacheRead !== 'number' || cacheRead < 0 || !Number.isFinite(cacheRead))) {
    return { ok: false, error: 'cache_read_price_per_1m must be a non-negative finite number or null' }
  }

  const cacheWrite = b['cache_write_price_per_1m']
  if (cacheWrite != null && (typeof cacheWrite !== 'number' || cacheWrite < 0 || !Number.isFinite(cacheWrite))) {
    return { ok: false, error: 'cache_write_price_per_1m must be a non-negative finite number or null' }
  }

  return {
    ok: true,
    data: {
      provider: b['provider'] as UpsertInput['provider'],
      model: b['model'],
      prompt_price_per_1m: b['prompt_price_per_1m'],
      completion_price_per_1m: b['completion_price_per_1m'],
      cache_read_price_per_1m: typeof cacheRead === 'number' ? cacheRead : null,
      cache_write_price_per_1m: typeof cacheWrite === 'number' ? cacheWrite : null,
    },
  }
}

/**
 * Admin-only model_prices CRUD.
 *
 *   GET    /api/v1/admin/model-prices               list all
 *   POST   /api/v1/admin/model-prices               upsert (provider+model)
 *   DELETE /api/v1/admin/model-prices/:id           remove
 *   GET    /api/v1/admin/model-prices/:id/history   change log for one row
 *
 * After every mutation, the in-memory cache is refreshed so the next request
 * sees the new price. Note: ONLY this function instance's cache is refreshed
 * — other Vercel instances pick up the change within their own 5-min TTL.
 *
 * Authorization: SPANLENS_ADMIN_EMAILS env var (see requireSystemAdmin).
 */
export const adminModelPricesRouter = new Hono<JwtContext>()

adminModelPricesRouter.use('*', authJwt)
adminModelPricesRouter.use('*', requireSystemAdmin)

// Best-effort actor tagging for the history trigger. RPC type-cast around
// generated Database types — the `set_spanlens_actor` function is added in
// migration 20260519000000 but Supabase types are regenerated separately.
async function setActor(userId: string): Promise<void> {
  await (supabaseAdmin.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<unknown>)('set_spanlens_actor', { actor_id: userId }).catch(() => {
    /* trigger falls back to NULL — audit_logs row still captures the actor */
  })
}

adminModelPricesRouter.get('/', async (c) => {
  const { data, error } = await supabaseAdmin
    .from('model_prices')
    .select('id, provider, model, prompt_price_per_1m, completion_price_per_1m, cache_read_price_per_1m, cache_write_price_per_1m, effective_from, created_at, updated_at')
    .order('provider', { ascending: true })
    .order('model', { ascending: true })

  if (error) throw new ApiError('INTERNAL_ERROR', 'Failed to fetch model prices')

  return c.json({
    success: true,
    data: data ?? [],
  })
})

adminModelPricesRouter.post('/', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json().catch(() => null)
  const parsed = parseUpsert(body)
  if (!parsed.ok) {
    throw new ApiError('VALIDATION_FAILED', parsed.error)
  }

  // Set actor for the history trigger via session GUC.
  await setActor(userId)

  const row = {
    provider: parsed.data.provider,
    model: parsed.data.model,
    prompt_price_per_1m: parsed.data.prompt_price_per_1m,
    completion_price_per_1m: parsed.data.completion_price_per_1m,
    cache_read_price_per_1m: parsed.data.cache_read_price_per_1m,
    cache_write_price_per_1m: parsed.data.cache_write_price_per_1m,
    effective_from: new Date().toISOString(),
  }

  const { data, error } = await supabaseAdmin
    .from('model_prices')
    .upsert(row, { onConflict: 'provider,model' })
    .select()
    .single()

  if (error) throw new ApiError('INTERNAL_ERROR', `Upsert failed: ${error.message}`)

  // Refresh cache so the new price is visible immediately on this instance.
  // Other instances pick it up within their TTL (≤5 min).
  await refreshPricesNow()

  // Write audit log (org-scoped audit log for traceability, even though
  // model_prices is global — the admin user's home org is fine).
  const orgId = c.get('orgId')
  if (orgId && data) {
    await supabaseAdmin.from('audit_logs').insert({
      organization_id: orgId,
      user_id: userId,
      action: 'model_price.upsert',
      resource_type: 'model_price',
      resource_id: (data as { id: string }).id,
      metadata: {
        provider: parsed.data.provider,
        model: parsed.data.model,
        prompt_price_per_1m: parsed.data.prompt_price_per_1m,
        completion_price_per_1m: parsed.data.completion_price_per_1m,
      },
    })
  }

  return c.json({ success: true, data })
})

adminModelPricesRouter.delete('/:id', async (c) => {
  const id = c.req.param('id')
  const userId = c.get('userId')

  await setActor(userId)

  const { error } = await supabaseAdmin
    .from('model_prices')
    .delete()
    .eq('id', id)

  if (error) throw new ApiError('INTERNAL_ERROR', `Delete failed: ${error.message}`)

  await refreshPricesNow()

  const orgId = c.get('orgId')
  if (orgId) {
    await supabaseAdmin.from('audit_logs').insert({
      organization_id: orgId,
      user_id: userId,
      action: 'model_price.delete',
      resource_type: 'model_price',
      resource_id: id,
    })
  }

  return c.json({ success: true })
})

adminModelPricesRouter.get('/:id/history', async (c) => {
  const id = c.req.param('id')
  const limit = Math.min(parsePositiveInt(c.req.query('limit'), 50), 200)
  const offset = parsePositiveInt(c.req.query('offset'), 0)

  const { data, error, count } = await supabaseAdmin
    .from('model_price_history')
    .select('*', { count: 'exact' })
    .eq('model_price_id', id)
    .order('changed_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) throw new ApiError('INTERNAL_ERROR', 'Failed to fetch history')

  return c.json({
    success: true,
    data: data ?? [],
    meta: { total: count ?? 0, limit, offset },
  })
})
