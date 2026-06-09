import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../middleware/authJwt.js'
import { supabaseAdmin } from '../lib/db.js'
import { runEvalRun, estimateJudgeCostUsd } from '../lib/eval-runner.js'
import { fireAndForget } from '../lib/wait-until.js'
import { ApiError } from '../lib/errors.js'

export const evalsRouter = new Hono<JwtContext>()

evalsRouter.use('*', authJwt)

// ── Evaluators (定義) ────────────────────────────────────────────────────────

// POST /api/v1/evaluators — create a reusable evaluator
evalsRouter.post('/evaluators', async (c) => {
  const orgId = c.get('orgId')
  const userId = c.get('userId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

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
    throw new ApiError('INVALID_JSON_BODY', 'Invalid JSON body')
  }

  const promptName = typeof body.promptName === 'string' ? body.promptName.trim() : ''
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const type = typeof body.type === 'string' ? body.type.trim() : 'llm_judge'

  if (!promptName) throw new ApiError('VALIDATION_FAILED', 'promptName is required')
  if (!name) throw new ApiError('VALIDATION_FAILED', 'name is required')
  if (type !== 'llm_judge' && type !== 'regex' && type !== 'json_schema') {
    throw new ApiError('VALIDATION_FAILED', 'type must be one of: llm_judge, regex, json_schema')
  }

  if (!body.config || typeof body.config !== 'object' || Array.isArray(body.config)) {
    throw new ApiError('VALIDATION_FAILED', 'config object is required')
  }
  const config = body.config as Record<string, unknown>

  // R-7 Phase 1 — per-type config validation. Each type carries its own
  // shape, and we store it verbatim so the runner can dispatch off the
  // `type` column without consulting a schema registry.
  let validatedConfig: Record<string, unknown>

  if (type === 'llm_judge') {
    const criterion = typeof config.criterion === 'string' ? config.criterion.trim() : ''
    const judgeProvider = typeof config.judge_provider === 'string' ? config.judge_provider : ''
    const judgeModel = typeof config.judge_model === 'string' ? config.judge_model.trim() : ''
    const scaleMin = typeof config.scale_min === 'number' ? config.scale_min : 0
    const scaleMax = typeof config.scale_max === 'number' ? config.scale_max : 1

    if (!criterion) throw new ApiError('VALIDATION_FAILED', 'config.criterion is required')
    if (judgeProvider !== 'openai' && judgeProvider !== 'anthropic' && judgeProvider !== 'gemini') {
      throw new ApiError('VALIDATION_FAILED', 'config.judge_provider must be "openai", "anthropic", or "gemini"')
    }
    if (!judgeModel) throw new ApiError('VALIDATION_FAILED', 'config.judge_model is required')
    if (!(scaleMax > scaleMin)) {
      throw new ApiError('VALIDATION_FAILED', 'config.scale_max must be greater than scale_min')
    }
    validatedConfig = { criterion, judge_provider: judgeProvider, judge_model: judgeModel, scale_min: scaleMin, scale_max: scaleMax }
  } else if (type === 'regex') {
    const pattern = typeof config.pattern === 'string' ? config.pattern : ''
    const flags = typeof config.flags === 'string' ? config.flags : ''
    if (!pattern) throw new ApiError('VALIDATION_FAILED', 'config.pattern is required')
    // Compile-test the pattern at create time so a typo can't lurk
    // until first eval run — same fail-fast pattern as score_configs
    // does for category validation.
    try {
      new RegExp(pattern, flags)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ error: `invalid regex pattern: ${message}` }, 400)
    }
    validatedConfig = { pattern, flags }
  } else {
    // type === 'json_schema'
    if (!config.schema || typeof config.schema !== 'object' || Array.isArray(config.schema)) {
      throw new ApiError('VALIDATION_FAILED', 'config.schema must be a JSON Schema object')
    }
    validatedConfig = { schema: config.schema }
  }

  // Verify prompt exists for this org
  const { count: promptCount } = await supabaseAdmin
    .from('prompt_versions')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq('name', promptName)
  if (!promptCount) throw new ApiError('NOT_FOUND', 'Prompt not found')

  // Optional score config — only meaningful for LLM-as-judge runs.
  // Verified to belong to the same org so a caller can't bind an
  // evaluator to someone else's config row.
  let scoreConfigId: string | null = null
  if (
    type === 'llm_judge' &&
    typeof body.scoreConfigId === 'string' &&
    body.scoreConfigId.trim().length > 0
  ) {
    const candidate = body.scoreConfigId.trim()
    const { data: sc } = await supabaseAdmin
      .from('score_configs')
      .select('id')
      .eq('id', candidate)
      .eq('organization_id', orgId)
      .is('archived_at', null)
      .maybeSingle()
    if (!sc) throw new ApiError('NOT_FOUND', 'scoreConfigId not found')
    scoreConfigId = sc.id
  }

  const { data, error } = await supabaseAdmin
    .from('evaluators')
    .insert({
      organization_id: orgId,
      prompt_name: promptName,
      name,
      type,
      config: validatedConfig,
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
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

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
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  const { data, error } = await supabaseAdmin
    .from('evaluator_templates')
    .select('id, slug, name, description, category, criterion, recommended_judge_provider, recommended_judge_model, display_order')
    .eq('is_active', true)
    .order('category', { ascending: true })
    .order('display_order', { ascending: true })

  if (error) throw new ApiError('INTERNAL_ERROR', 'Failed to load templates')
  return c.json({ success: true, data: data ?? [] })
})

// DELETE /api/v1/evaluators/:id — soft delete (archive)
evalsRouter.delete('/evaluators/:id', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

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
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

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
    throw new ApiError('INVALID_JSON_BODY', 'Invalid JSON body')
  }

  const evaluatorId = typeof body.evaluatorId === 'string' ? body.evaluatorId.trim() : ''
  const promptVersionId = typeof body.promptVersionId === 'string' ? body.promptVersionId.trim() : ''
  const source = body.source === 'dataset' ? 'dataset' : 'production'
  const datasetId = typeof body.datasetId === 'string' ? body.datasetId.trim() : null
  const sampleSize = typeof body.sampleSize === 'number' ? Math.round(body.sampleSize) : 50
  const sampleFrom = typeof body.sampleFrom === 'string' ? body.sampleFrom : null
  const sampleTo = typeof body.sampleTo === 'string' ? body.sampleTo : null

  if (!evaluatorId) throw new ApiError('VALIDATION_FAILED', 'evaluatorId is required')
  if (!promptVersionId) throw new ApiError('VALIDATION_FAILED', 'promptVersionId is required')
  if (sampleSize < 1 || sampleSize > 1000) {
    throw new ApiError('VALIDATION_FAILED', 'sampleSize must be between 1 and 1000')
  }
  if (source === 'dataset' && !datasetId) {
    throw new ApiError('VALIDATION_FAILED', 'datasetId is required when source = dataset')
  }

  // Dataset evals run the prompt against each item's input before judging.
  // The picker can only emit our three supported provider strings.
  const runProvider: 'openai' | 'anthropic' | 'gemini' | null =
    body.runProvider === 'openai' || body.runProvider === 'anthropic' || body.runProvider === 'gemini'
      ? body.runProvider
      : null
  const runModel = typeof body.runModel === 'string' ? body.runModel.trim() : null
  if (source === 'dataset') {
    if (!runProvider) throw new ApiError('VALIDATION_FAILED', 'runProvider is required when source = dataset')
    if (!runModel) throw new ApiError('VALIDATION_FAILED', 'runModel is required when source = dataset')
  }

  // Verify both belong to org
  const { data: evaluator } = await supabaseAdmin
    .from('evaluators')
    .select('id')
    .eq('id', evaluatorId)
    .eq('organization_id', orgId)
    .is('archived_at', null)
    .maybeSingle()
  if (!evaluator) throw new ApiError('NOT_FOUND', 'Evaluator not found')

  const { data: pv } = await supabaseAdmin
    .from('prompt_versions')
    .select('id')
    .eq('id', promptVersionId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!pv) throw new ApiError('NOT_FOUND', 'Prompt version not found')

  // Verify dataset belongs to org if requested
  if (source === 'dataset' && datasetId) {
    const { data: ds } = await supabaseAdmin
      .from('datasets')
      .select('id')
      .eq('id', datasetId)
      .eq('organization_id', orgId)
      .is('archived_at', null)
      .maybeSingle()
    if (!ds) throw new ApiError('NOT_FOUND', 'Dataset not found')
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
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

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
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  const id = c.req.param('id')
  const { data, error } = await supabaseAdmin
    .from('eval_runs')
    .select('*, evaluators(name, config)')
    .eq('id', id)
    .eq('organization_id', orgId)
    .maybeSingle()

  if (error || !data) throw new ApiError('NOT_FOUND', 'Eval run not found')
  return c.json({ success: true, data })
})

// GET /api/v1/eval-runs/:id/results
evalsRouter.get('/eval-runs/:id/results', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  const runId = c.req.param('id')

  // Verify run belongs to org first (extra safety on top of RLS)
  const { data: run } = await supabaseAdmin
    .from('eval_runs')
    .select('id')
    .eq('id', runId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!run) throw new ApiError('NOT_FOUND', 'Eval run not found')

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
    throw new ApiError('INVALID_JSON_BODY', 'Invalid JSON body')
  }
  const sampleSize = typeof body.sampleSize === 'number' ? Math.round(body.sampleSize) : 50
  const judgeModel = typeof body.judgeModel === 'string' ? body.judgeModel : 'gpt-4o-mini'
  const estimateUsd = estimateJudgeCostUsd(sampleSize, judgeModel)
  return c.json({ success: true, data: { estimateUsd } })
})
