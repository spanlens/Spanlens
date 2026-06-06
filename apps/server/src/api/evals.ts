import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../middleware/authJwt.js'
import { supabaseAdmin } from '../lib/db.js'
import { runEvalRun, estimateJudgeCostUsd } from '../lib/eval-runner.js'
import { fireAndForget } from '../lib/wait-until.js'

export const evalsRouter = new Hono<JwtContext>()

evalsRouter.use('*', authJwt)

// ── Evaluators (定義) ────────────────────────────────────────────────────────

// POST /api/v1/evaluators — create a reusable evaluator
evalsRouter.post('/evaluators', async (c) => {
  const orgId = c.get('orgId')
  const userId = c.get('userId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  let body: {
    promptName?: unknown
    name?: unknown
    type?: unknown
    config?: unknown
    // 4B.1c — optional pointer at a typed score config. NULL preserves
    // the legacy NUMERIC 0..1 behaviour.
    scoreConfigId?: unknown
  }
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const promptName = typeof body.promptName === 'string' ? body.promptName.trim() : ''
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const type = typeof body.type === 'string' ? body.type.trim() : 'llm_judge'

  if (!promptName) return c.json({ error: 'promptName is required' }, 400)
  if (!name) return c.json({ error: 'name is required' }, 400)
  if (type !== 'llm_judge') return c.json({ error: 'Unsupported evaluator type' }, 400)

  if (!body.config || typeof body.config !== 'object' || Array.isArray(body.config)) {
    return c.json({ error: 'config object is required' }, 400)
  }
  const config = body.config as Record<string, unknown>

  const criterion = typeof config.criterion === 'string' ? config.criterion.trim() : ''
  const judgeProvider = typeof config.judge_provider === 'string' ? config.judge_provider : ''
  const judgeModel = typeof config.judge_model === 'string' ? config.judge_model.trim() : ''
  const scaleMin = typeof config.scale_min === 'number' ? config.scale_min : 0
  const scaleMax = typeof config.scale_max === 'number' ? config.scale_max : 1

  if (!criterion) return c.json({ error: 'config.criterion is required' }, 400)
  if (judgeProvider !== 'openai' && judgeProvider !== 'anthropic' && judgeProvider !== 'gemini') {
    return c.json({ error: 'config.judge_provider must be "openai", "anthropic", or "gemini"' }, 400)
  }
  if (!judgeModel) return c.json({ error: 'config.judge_model is required' }, 400)
  if (!(scaleMax > scaleMin)) {
    return c.json({ error: 'config.scale_max must be greater than scale_min' }, 400)
  }

  // Verify prompt exists for this org
  const { count: promptCount } = await supabaseAdmin
    .from('prompt_versions')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq('name', promptName)
  if (!promptCount) return c.json({ error: 'Prompt not found' }, 404)

  // Optional score config — verified to belong to the same org so a
  // caller can't bind an evaluator to someone else's config row.
  let scoreConfigId: string | null = null
  if (typeof body.scoreConfigId === 'string' && body.scoreConfigId.trim().length > 0) {
    const candidate = body.scoreConfigId.trim()
    const { data: sc } = await supabaseAdmin
      .from('score_configs')
      .select('id')
      .eq('id', candidate)
      .eq('organization_id', orgId)
      .is('archived_at', null)
      .maybeSingle()
    if (!sc) return c.json({ error: 'scoreConfigId not found' }, 404)
    scoreConfigId = sc.id
  }

  const { data, error } = await supabaseAdmin
    .from('evaluators')
    .insert({
      organization_id: orgId,
      prompt_name: promptName,
      name,
      type,
      config: { criterion, judge_provider: judgeProvider, judge_model: judgeModel, scale_min: scaleMin, scale_max: scaleMax },
      created_by: userId ?? null,
      score_config_id: scoreConfigId,
    })
    .select()
    .single()

  if (error || !data) {
    return c.json({ error: error?.message ?? 'Failed to create evaluator' }, 500)
  }
  return c.json({ success: true, data }, 201)
})

// GET /api/v1/evaluators?promptName=...
evalsRouter.get('/evaluators', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const promptName = c.req.query('promptName')

  let query = supabaseAdmin
    .from('evaluators')
    .select('*')
    .eq('organization_id', orgId)
    .is('archived_at', null)
    .order('created_at', { ascending: false })

  if (promptName) query = query.eq('prompt_name', promptName)

  const { data, error } = await query
  if (error) return c.json({ error: error.message }, 500)
  return c.json({ success: true, data: data ?? [] })
})

// GET /api/v1/evaluator-templates — global catalogue of pre-baked evaluators
//
// The dashboard renders these as quick-start cards on the empty state of
// /evals. The catalogue is workspace-agnostic: every org sees the same
// suggestions (RLS on the table allows any authenticated user to read).
// Active rows only, ordered category → display_order so the response is
// already render-ready.
evalsRouter.get('/evaluator-templates', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const { data, error } = await supabaseAdmin
    .from('evaluator_templates')
    .select('id, slug, name, description, category, criterion, recommended_judge_provider, recommended_judge_model, display_order')
    .eq('is_active', true)
    .order('category', { ascending: true })
    .order('display_order', { ascending: true })

  if (error) return c.json({ error: 'Failed to load templates' }, 500)
  return c.json({ success: true, data: data ?? [] })
})

// DELETE /api/v1/evaluators/:id — soft delete (archive)
evalsRouter.delete('/evaluators/:id', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const id = c.req.param('id')
  const { error } = await supabaseAdmin
    .from('evaluators')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id)
    .eq('organization_id', orgId)

  if (error) return c.json({ error: error.message }, 500)
  return c.json({ success: true })
})

// ── Eval runs (실행) ─────────────────────────────────────────────────────────

// POST /api/v1/eval-runs — kick off a run (returns immediately, run executes in background)
evalsRouter.post('/eval-runs', async (c) => {
  const orgId = c.get('orgId')
  const userId = c.get('userId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  let body: {
    evaluatorId?: unknown
    promptVersionId?: unknown
    source?: unknown
    datasetId?: unknown
    sampleSize?: unknown
    sampleFrom?: unknown
    sampleTo?: unknown
    runProvider?: unknown
    runModel?: unknown
  }
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const evaluatorId = typeof body.evaluatorId === 'string' ? body.evaluatorId.trim() : ''
  const promptVersionId = typeof body.promptVersionId === 'string' ? body.promptVersionId.trim() : ''
  const source = body.source === 'dataset' ? 'dataset' : 'production'
  const datasetId = typeof body.datasetId === 'string' ? body.datasetId.trim() : null
  const sampleSize = typeof body.sampleSize === 'number' ? Math.round(body.sampleSize) : 50
  const sampleFrom = typeof body.sampleFrom === 'string' ? body.sampleFrom : null
  const sampleTo = typeof body.sampleTo === 'string' ? body.sampleTo : null

  if (!evaluatorId) return c.json({ error: 'evaluatorId is required' }, 400)
  if (!promptVersionId) return c.json({ error: 'promptVersionId is required' }, 400)
  if (sampleSize < 1 || sampleSize > 1000) {
    return c.json({ error: 'sampleSize must be between 1 and 1000' }, 400)
  }
  if (source === 'dataset' && !datasetId) {
    return c.json({ error: 'datasetId is required when source = dataset' }, 400)
  }

  // Dataset evals run the prompt against each item's input before judging.
  // The picker can only emit our three supported provider strings.
  const runProvider: 'openai' | 'anthropic' | 'gemini' | null =
    body.runProvider === 'openai' || body.runProvider === 'anthropic' || body.runProvider === 'gemini'
      ? body.runProvider
      : null
  const runModel = typeof body.runModel === 'string' ? body.runModel.trim() : null
  if (source === 'dataset') {
    if (!runProvider) return c.json({ error: 'runProvider is required when source = dataset' }, 400)
    if (!runModel) return c.json({ error: 'runModel is required when source = dataset' }, 400)
  }

  // Verify both belong to org
  const { data: evaluator } = await supabaseAdmin
    .from('evaluators')
    .select('id')
    .eq('id', evaluatorId)
    .eq('organization_id', orgId)
    .is('archived_at', null)
    .maybeSingle()
  if (!evaluator) return c.json({ error: 'Evaluator not found' }, 404)

  const { data: pv } = await supabaseAdmin
    .from('prompt_versions')
    .select('id')
    .eq('id', promptVersionId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!pv) return c.json({ error: 'Prompt version not found' }, 404)

  // Verify dataset belongs to org if requested
  if (source === 'dataset' && datasetId) {
    const { data: ds } = await supabaseAdmin
      .from('datasets')
      .select('id')
      .eq('id', datasetId)
      .eq('organization_id', orgId)
      .is('archived_at', null)
      .maybeSingle()
    if (!ds) return c.json({ error: 'Dataset not found' }, 404)
  }

  const { data: run, error: runErr } = await supabaseAdmin
    .from('eval_runs')
    .insert({
      organization_id: orgId,
      evaluator_id: evaluatorId,
      prompt_version_id: promptVersionId,
      source,
      dataset_id: source === 'dataset' ? datasetId : null,
      sample_size: sampleSize,
      sample_from: source === 'production' ? sampleFrom : null,
      sample_to: source === 'production' ? sampleTo : null,
      status: 'pending',
      created_by: userId ?? null,
    })
    .select()
    .single()

  if (runErr || !run) {
    return c.json({ error: runErr?.message ?? 'Failed to create run' }, 500)
  }

  // Kick off the worker in background. The HTTP caller polls GET /eval-runs/:id.
  fireAndForget(c, runEvalRun({
    evalRunId: run.id,
    organizationId: orgId,
    evaluatorId,
    promptVersionId,
    source,
    datasetId,
    sampleSize,
    sampleFrom,
    sampleTo,
    runProvider,
    runModel,
  }))

  return c.json({ success: true, data: run }, 202)
})

// GET /api/v1/eval-runs?evaluatorId=...&promptVersionId=...
evalsRouter.get('/eval-runs', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const evaluatorId = c.req.query('evaluatorId')
  const promptVersionId = c.req.query('promptVersionId')

  let query = supabaseAdmin
    .from('eval_runs')
    .select('*')
    .eq('organization_id', orgId)
    .order('started_at', { ascending: false })
    .limit(50)

  if (evaluatorId) query = query.eq('evaluator_id', evaluatorId)
  if (promptVersionId) query = query.eq('prompt_version_id', promptVersionId)

  const { data, error } = await query
  if (error) return c.json({ error: error.message }, 500)
  return c.json({ success: true, data: data ?? [] })
})

// GET /api/v1/eval-runs/:id
evalsRouter.get('/eval-runs/:id', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const id = c.req.param('id')
  const { data, error } = await supabaseAdmin
    .from('eval_runs')
    .select('*, evaluators(name, config)')
    .eq('id', id)
    .eq('organization_id', orgId)
    .maybeSingle()

  if (error || !data) return c.json({ error: 'Eval run not found' }, 404)
  return c.json({ success: true, data })
})

// GET /api/v1/eval-runs/:id/results
evalsRouter.get('/eval-runs/:id/results', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const runId = c.req.param('id')

  // Verify run belongs to org first (extra safety on top of RLS)
  const { data: run } = await supabaseAdmin
    .from('eval_runs')
    .select('id')
    .eq('id', runId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!run) return c.json({ error: 'Eval run not found' }, 404)

  const { data, error } = await supabaseAdmin
    .from('eval_results')
    .select('*')
    .eq('eval_run_id', runId)
    .order('score', { ascending: true })

  if (error) return c.json({ error: error.message }, 500)
  return c.json({ success: true, data: data ?? [] })
})

// POST /api/v1/eval-runs/estimate — cost estimate for a planned run
evalsRouter.post('/eval-runs/estimate', async (c) => {
  let body: { sampleSize?: unknown; judgeModel?: unknown }
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }
  const sampleSize = typeof body.sampleSize === 'number' ? Math.round(body.sampleSize) : 50
  const judgeModel = typeof body.judgeModel === 'string' ? body.judgeModel : 'gpt-4o-mini'
  const estimateUsd = estimateJudgeCostUsd(sampleSize, judgeModel)
  return c.json({ success: true, data: { estimateUsd } })
})
