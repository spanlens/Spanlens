import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { authJwtOrApiKey, type DualAuthContext } from '../middleware/authJwtOrApiKey.js'
import { requireFullScope } from '../middleware/requireFullScope.js'
import { supabaseAdmin } from '../lib/db.js'
import { runEvalRun, estimateJudgeCostUsd } from '../lib/eval-runner.js'
import { EMBEDDING_PROVIDERS } from '../lib/eval-runners/embedding.js'
import { fireAndForget } from '../lib/wait-until.js'
import { ApiError } from '../lib/errors.js'
import { parsePageLimit } from '../lib/params.js'

// P2-8: evals are dual-auth so CI / SDK can run them with an sl_live_* key,
// not just a dashboard JWT — this is the "prompt CI" enabler. Reads accept
// full + public keys; routes that write evaluator config or spend the
// provider key (evaluator CRUD, eval-run trigger) add requireFullScope so a
// public (sl_live_pub_*) key stays read-only. requireFullScope is a no-op on
// the JWT path (apiKeyScope is unset), so dashboard behaviour is unchanged.
export const evalsRouter = new Hono<DualAuthContext>()

evalsRouter.use('*', authJwtOrApiKey)

// Dual-auth write gate for evaluator CRUD + eval-run triggers.
//   - API-key path: `role` is null and requireFullScope has already narrowed the
//     caller to a FULL sl_live_* key. That is the intended "prompt CI with an
//     sl_live_* key" flow (see header comment), so allow it through.
//   - JWT (dashboard) path: require admin/editor so a viewer-role member can't
//     create evaluators or trigger billable eval runs.
// Plain requireRole('admin','editor') would reject the null-role API-key path
// and break CI, so this variant only enforces the role check when a role is set.
const requireEdit = createMiddleware<DualAuthContext>(async (c, next) => {
  const role = c.get('role')
  if (role != null && role !== 'admin' && role !== 'editor') {
    throw ApiError.from('FORBIDDEN', { required: ['admin', 'editor'], actual: role })
  }
  return next()
})

// ── Evaluators (定義) ────────────────────────────────────────────────────────

// POST /api/v1/evaluators — create a reusable evaluator
evalsRouter.post('/evaluators', requireFullScope, requireEdit, async (c) => {
  const orgId = c.get('orgId')
  const userId = c.get('userId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  let body: {
    promptName?: unknown
    name?: unknown
    type?: unknown
    config?: unknown
    // P2-11 — trajectory evaluators target traces by name, not a prompt.
    traceName?: unknown
    // 4B.1c — optional pointer at a typed score config. NULL preserves
    // the legacy NUMERIC 0..1 behaviour.
    scoreConfigId?: unknown
    // P2-10 — auto-run on new prompt version (golden regression suite).
    autoRunOnVersion?: unknown
    autoRunDatasetId?: unknown
    autoRunProvider?: unknown
    autoRunModel?: unknown
    autoRunSampleSize?: unknown
  }
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    throw new ApiError('INVALID_JSON_BODY', 'Invalid JSON body')
  }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const type = typeof body.type === 'string' ? body.type.trim() : 'llm_judge'
  // P2-11: trajectory evaluators bind to a TRACE name, not a prompt. We reuse
  // the prompt_name column to hold it (it's just the grouping label), so the
  // existing list UI groups trajectory evaluators under their trace name.
  const traceName = typeof body.traceName === 'string' ? body.traceName.trim() : ''
  const promptName = type === 'trajectory'
    ? traceName
    : (typeof body.promptName === 'string' ? body.promptName.trim() : '')

  if (!promptName) {
    throw new ApiError('VALIDATION_FAILED', type === 'trajectory' ? 'traceName is required' : 'promptName is required')
  }
  if (!name) throw new ApiError('VALIDATION_FAILED', 'name is required')
  const VALID_EVALUATOR_TYPES = ['llm_judge', 'regex', 'json_schema', 'exact_match', 'contains', 'embedding', 'trajectory']
  if (!VALID_EVALUATOR_TYPES.includes(type)) {
    throw new ApiError('VALIDATION_FAILED', `type must be one of: ${VALID_EVALUATOR_TYPES.join(', ')}`)
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
    const VALID_JUDGE_PROVIDERS = ['openai', 'anthropic', 'gemini', 'azure', 'mistral', 'openrouter']
    if (!VALID_JUDGE_PROVIDERS.includes(judgeProvider)) {
      throw new ApiError('VALIDATION_FAILED', `config.judge_provider must be one of: ${VALID_JUDGE_PROVIDERS.join(', ')}`)
    }
    if (!judgeModel) throw new ApiError('VALIDATION_FAILED', 'config.judge_model is required')
    if (!(scaleMax > scaleMin)) {
      throw new ApiError('VALIDATION_FAILED', 'config.scale_max must be greater than scale_min')
    }

    // P1-7 — optional rubric (free-form guidance) + few-shot calibration
    // anchors. Both are stored verbatim on the config jsonb and injected into
    // the judge prompt; absent fields keep the prompt byte-identical.
    const RUBRIC_MAX = 4000
    const ANCHORS_MAX = 10
    const ANCHOR_RESPONSE_MAX = 4000
    const ANCHOR_REASONING_MAX = 500
    const rubric = typeof config.rubric === 'string' ? config.rubric.trim() : ''
    if (rubric.length > RUBRIC_MAX) {
      throw new ApiError('VALIDATION_FAILED', `config.rubric must be at most ${RUBRIC_MAX} characters`)
    }
    const anchors: Array<{ response: string; score: number; reasoning?: string }> = []
    if (config.anchors !== undefined) {
      if (!Array.isArray(config.anchors)) {
        throw new ApiError('VALIDATION_FAILED', 'config.anchors must be an array')
      }
      if (config.anchors.length > ANCHORS_MAX) {
        throw new ApiError('VALIDATION_FAILED', `config.anchors supports at most ${ANCHORS_MAX} examples`)
      }
      for (const raw of config.anchors) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
          throw new ApiError('VALIDATION_FAILED', 'each anchor must be an object')
        }
        const a = raw as Record<string, unknown>
        const response = typeof a.response === 'string' ? a.response.trim() : ''
        const score = typeof a.score === 'number' ? a.score : NaN
        if (!response) throw new ApiError('VALIDATION_FAILED', 'each anchor needs a non-empty response')
        if (response.length > ANCHOR_RESPONSE_MAX) {
          throw new ApiError('VALIDATION_FAILED', `anchor response must be at most ${ANCHOR_RESPONSE_MAX} characters`)
        }
        if (!Number.isFinite(score) || score < scaleMin || score > scaleMax) {
          throw new ApiError('VALIDATION_FAILED', `anchor score must be a number between ${scaleMin} and ${scaleMax}`)
        }
        const reasoning = typeof a.reasoning === 'string' ? a.reasoning.trim() : ''
        // Cap reasoning too: unlike `response` (truncated to 280 chars in the
        // prompt) it is embedded verbatim into every judge call, so an
        // oversized note would silently inflate token cost / blow the context.
        if (reasoning.length > ANCHOR_REASONING_MAX) {
          throw new ApiError('VALIDATION_FAILED', `anchor reasoning must be at most ${ANCHOR_REASONING_MAX} characters`)
        }
        anchors.push({ response, score, ...(reasoning ? { reasoning } : {}) })
      }
    }

    validatedConfig = {
      criterion,
      judge_provider: judgeProvider,
      judge_model: judgeModel,
      scale_min: scaleMin,
      scale_max: scaleMax,
      ...(rubric ? { rubric } : {}),
      ...(anchors.length > 0 ? { anchors } : {}),
    }
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
      throw new ApiError('VALIDATION_FAILED', `invalid regex pattern: ${message}`)
    }
    validatedConfig = { pattern, flags }
  } else if (type === 'json_schema') {
    if (!config.schema || typeof config.schema !== 'object' || Array.isArray(config.schema)) {
      throw new ApiError('VALIDATION_FAILED', 'config.schema must be a JSON Schema object')
    }
    validatedConfig = { schema: config.schema }
  } else if (type === 'exact_match') {
    const value = typeof config.value === 'string' ? config.value : ''
    if (!value) throw new ApiError('VALIDATION_FAILED', 'config.value is required')
    validatedConfig = {
      value,
      caseSensitive: config.caseSensitive === true,
      trim: config.trim !== false,
    }
  } else if (type === 'contains') {
    const substring = typeof config.substring === 'string' ? config.substring : ''
    if (!substring) throw new ApiError('VALIDATION_FAILED', 'config.substring is required')
    validatedConfig = {
      substring,
      caseSensitive: config.caseSensitive === true,
    }
  } else if (type === 'embedding') {
    const provider = typeof config.provider === 'string' ? config.provider : ''
    const model = typeof config.model === 'string' ? config.model.trim() : ''
    if (!EMBEDDING_PROVIDERS.includes(provider as (typeof EMBEDDING_PROVIDERS)[number])) {
      throw new ApiError('VALIDATION_FAILED', `config.provider must be one of: ${EMBEDDING_PROVIDERS.join(', ')}`)
    }
    if (!model) throw new ApiError('VALIDATION_FAILED', 'config.model is required')
    const referenceText = typeof config.reference_text === 'string' ? config.reference_text : null
    const threshold = typeof config.threshold === 'number' ? config.threshold : null
    if (threshold != null && (threshold < 0 || threshold > 1)) {
      throw new ApiError('VALIDATION_FAILED', 'config.threshold must be between 0 and 1')
    }
    validatedConfig = {
      provider,
      model,
      ...(referenceText ? { reference_text: referenceText } : {}),
      ...(threshold != null ? { threshold } : {}),
    }
  } else {
    // type === 'trajectory' (P2-11). LLM-as-judge over an agent trace; binds to
    // a trace name (carried in config.trace_name) instead of a prompt version.
    const criterion = typeof config.criterion === 'string' ? config.criterion.trim() : ''
    const judgeProvider = typeof config.judge_provider === 'string' ? config.judge_provider : ''
    const judgeModel = typeof config.judge_model === 'string' ? config.judge_model.trim() : ''
    const scaleMin = typeof config.scale_min === 'number' ? config.scale_min : 0
    const scaleMax = typeof config.scale_max === 'number' ? config.scale_max : 1
    const rubric = typeof config.rubric === 'string' ? config.rubric.trim() : ''
    if (!criterion) throw new ApiError('VALIDATION_FAILED', 'config.criterion is required')
    const VALID_JUDGE_PROVIDERS = ['openai', 'anthropic', 'gemini', 'azure', 'mistral', 'openrouter']
    if (!VALID_JUDGE_PROVIDERS.includes(judgeProvider)) {
      throw new ApiError('VALIDATION_FAILED', `config.judge_provider must be one of: ${VALID_JUDGE_PROVIDERS.join(', ')}`)
    }
    if (!judgeModel) throw new ApiError('VALIDATION_FAILED', 'config.judge_model is required')
    if (!(scaleMax > scaleMin)) {
      throw new ApiError('VALIDATION_FAILED', 'config.scale_max must be greater than scale_min')
    }
    if (rubric.length > 4000) {
      throw new ApiError('VALIDATION_FAILED', 'config.rubric must be at most 4000 characters')
    }
    // trace_name carried in config (authoritative for the runner); we also
    // stored it as prompt_name above for grouping.
    validatedConfig = {
      criterion,
      judge_provider: judgeProvider,
      judge_model: judgeModel,
      scale_min: scaleMin,
      scale_max: scaleMax,
      trace_name: traceName,
      ...(rubric ? { rubric } : {}),
    }
  }

  // Verify the prompt exists for this org — EXCEPT trajectory evaluators, whose
  // prompt_name holds a trace name (not a prompt). Trace names are free-form
  // (the customer's SDK chose them), so there's nothing to verify against.
  if (type !== 'trajectory') {
    const { count: promptCount } = await supabaseAdmin
      .from('prompt_versions')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('name', promptName)
    if (!promptCount) throw new ApiError('NOT_FOUND', 'Prompt not found')
  }

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

  // P2-10 — auto-run config (golden regression suite). When enabled, a new
  // version of this evaluator's prompt auto-triggers a dataset eval run. New
  // versions have no production traffic, so a dataset + run model are required.
  const autoRunOnVersion = body.autoRunOnVersion === true
  let autoRunDatasetId: string | null = null
  let autoRunProvider: string | null = null
  let autoRunModel: string | null = null
  let autoRunSampleSize: number | null = null
  if (autoRunOnVersion) {
    autoRunDatasetId = typeof body.autoRunDatasetId === 'string' ? body.autoRunDatasetId.trim() : ''
    autoRunProvider = typeof body.autoRunProvider === 'string' ? body.autoRunProvider : ''
    autoRunModel = typeof body.autoRunModel === 'string' ? body.autoRunModel.trim() : ''
    const RUN_PROVIDERS = ['openai', 'anthropic', 'gemini', 'azure', 'mistral', 'openrouter']
    if (!autoRunDatasetId) throw new ApiError('VALIDATION_FAILED', 'autoRunDatasetId is required when autoRunOnVersion is true')
    if (!RUN_PROVIDERS.includes(autoRunProvider)) {
      throw new ApiError('VALIDATION_FAILED', `autoRunProvider must be one of: ${RUN_PROVIDERS.join(', ')}`)
    }
    if (!autoRunModel) throw new ApiError('VALIDATION_FAILED', 'autoRunModel is required when autoRunOnVersion is true')
    autoRunSampleSize = typeof body.autoRunSampleSize === 'number' ? Math.round(body.autoRunSampleSize) : 50
    if (autoRunSampleSize < 1 || autoRunSampleSize > 1000) {
      throw new ApiError('VALIDATION_FAILED', 'autoRunSampleSize must be between 1 and 1000')
    }
    // Verify the dataset belongs to this org.
    const { data: ds } = await supabaseAdmin
      .from('datasets')
      .select('id')
      .eq('id', autoRunDatasetId)
      .eq('organization_id', orgId)
      .is('archived_at', null)
      .maybeSingle()
    if (!ds) throw new ApiError('NOT_FOUND', 'autoRunDatasetId not found')
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
      auto_run_on_version: autoRunOnVersion,
      auto_run_dataset_id: autoRunDatasetId,
      auto_run_provider: autoRunProvider,
      auto_run_model: autoRunModel,
      auto_run_sample_size: autoRunSampleSize,
    })
    .select()
    .single()

  if (error || !data) {
    throw new ApiError('INTERNAL_ERROR', error?.message ?? 'Failed to create evaluator')
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
  if (error) throw new ApiError('INTERNAL_ERROR', error.message)
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
evalsRouter.delete('/evaluators/:id', requireFullScope, async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  const id = c.req.param('id')
  const { error } = await supabaseAdmin
    .from('evaluators')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id)
    .eq('organization_id', orgId)

  if (error) throw new ApiError('INTERNAL_ERROR', error.message)
  return c.json({ success: true })
})

// ── Eval runs (실행) ─────────────────────────────────────────────────────────

// POST /api/v1/eval-runs — kick off a run (returns immediately, run executes in background)
evalsRouter.post('/eval-runs', requireFullScope, requireEdit, async (c) => {
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
    sampleStrategy?: unknown
    generationTemperature?: unknown
    mode?: unknown
    promptVersionBId?: unknown
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
  // P1-4 / P1-5: sampling strategy (default 'recent' = legacy) and generation
  // temperature (default 0 = reproducible).
  const sampleStrategy = body.sampleStrategy === 'random' ? 'random' : 'recent'
  const generationTemperature =
    typeof body.generationTemperature === 'number' ? body.generationTemperature : 0

  if (!evaluatorId) throw new ApiError('VALIDATION_FAILED', 'evaluatorId is required')

  // Fetch the evaluator early — its type decides whether this is a trajectory
  // run (P2-11), which targets traces by name and has NO prompt version.
  const { data: evaluator } = await supabaseAdmin
    .from('evaluators')
    .select('id, type')
    .eq('id', evaluatorId)
    .eq('organization_id', orgId)
    .is('archived_at', null)
    .maybeSingle()
  if (!evaluator) throw new ApiError('NOT_FOUND', 'Evaluator not found')
  const isTrajectory = evaluator.type === 'trajectory'

  if (!isTrajectory && !promptVersionId) throw new ApiError('VALIDATION_FAILED', 'promptVersionId is required')
  if (sampleSize < 1 || sampleSize > 1000) {
    throw new ApiError('VALIDATION_FAILED', 'sampleSize must be between 1 and 1000')
  }
  if (generationTemperature < 0 || generationTemperature > 2) {
    throw new ApiError('VALIDATION_FAILED', 'generationTemperature must be between 0 and 2')
  }
  if (!isTrajectory && source === 'dataset' && !datasetId) {
    throw new ApiError('VALIDATION_FAILED', 'datasetId is required when source = dataset')
  }

  // Dataset evals run the prompt against each item's input before judging.
  const RUN_PROVIDERS = ['openai', 'anthropic', 'gemini', 'azure', 'mistral', 'openrouter'] as const
  type RunProvider = typeof RUN_PROVIDERS[number]
  const runProvider: RunProvider | null =
    typeof body.runProvider === 'string' && (RUN_PROVIDERS as readonly string[]).includes(body.runProvider)
      ? (body.runProvider as RunProvider)
      : null
  const runModel = typeof body.runModel === 'string' ? body.runModel.trim() : null
  if (!isTrajectory && source === 'dataset') {
    if (!runProvider) throw new ApiError('VALIDATION_FAILED', 'runProvider is required when source = dataset')
    if (!runModel) throw new ApiError('VALIDATION_FAILED', 'runModel is required when source = dataset')
  }

  // P1-7 (3/3): pairwise (A vs B) mode. Requires a dataset source + a second
  // prompt version. Generation (run provider/model) is required because both
  // versions must be executed to produce the two responses being compared.
  const mode = body.mode === 'pairwise' ? 'pairwise' : 'single'
  const promptVersionBId = typeof body.promptVersionBId === 'string' ? body.promptVersionBId.trim() : null
  if (mode === 'pairwise') {
    if (source !== 'dataset') throw new ApiError('VALIDATION_FAILED', 'pairwise mode requires source = dataset')
    if (!promptVersionBId) throw new ApiError('VALIDATION_FAILED', 'promptVersionBId is required for a pairwise run')
    if (promptVersionBId === promptVersionId) {
      throw new ApiError('VALIDATION_FAILED', 'promptVersionBId must differ from promptVersionId')
    }
    if (!runProvider || !runModel) {
      throw new ApiError('VALIDATION_FAILED', 'runProvider and runModel are required for a pairwise run')
    }
  }

  if (mode === 'pairwise' && evaluator.type !== 'llm_judge') {
    throw new ApiError('VALIDATION_FAILED', 'pairwise mode requires an llm_judge evaluator')
  }

  // Verify version B belongs to org (pairwise only).
  if (mode === 'pairwise' && promptVersionBId) {
    const { data: pvB } = await supabaseAdmin
      .from('prompt_versions')
      .select('id')
      .eq('id', promptVersionBId)
      .eq('organization_id', orgId)
      .maybeSingle()
    if (!pvB) throw new ApiError('NOT_FOUND', 'promptVersionBId not found')
  }

  // Verify the prompt version belongs to org — skipped for trajectory runs,
  // which have no prompt version (they target traces by name).
  if (!isTrajectory) {
    const { data: pv } = await supabaseAdmin
      .from('prompt_versions')
      .select('id')
      .eq('id', promptVersionId)
      .eq('organization_id', orgId)
      .maybeSingle()
    if (!pv) throw new ApiError('NOT_FOUND', 'Prompt version not found')
  }

  // Verify dataset belongs to org if requested (not for trajectory).
  if (!isTrajectory && source === 'dataset' && datasetId) {
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
      // Trajectory runs have no prompt version; the runner fills trace_name.
      prompt_version_id: isTrajectory ? null : promptVersionId,
      source,
      dataset_id: !isTrajectory && source === 'dataset' ? datasetId : null,
      sample_size: sampleSize,
      sample_from: source === 'production' ? sampleFrom : null,
      sample_to: source === 'production' ? sampleTo : null,
      status: 'pending',
      created_by: userId ?? null,
      mode,
      prompt_version_b_id: mode === 'pairwise' ? promptVersionBId : null,
    })
    .select()
    .single()

  if (runErr || !run) {
    throw new ApiError('INTERNAL_ERROR', runErr?.message ?? 'Failed to create run')
  }

  // Kick off the worker in background. The HTTP caller polls GET /eval-runs/:id.
  // Trajectory runs have no prompt version (the runner reads the evaluator's
  // config.trace_name); pass null.
  fireAndForget(c, runEvalRun({
    evalRunId: run.id,
    organizationId: orgId,
    evaluatorId,
    promptVersionId: isTrajectory ? null : promptVersionId,
    source,
    datasetId,
    sampleSize,
    sampleFrom,
    sampleTo,
    runProvider,
    runModel,
    sampleStrategy,
    generationTemperature,
    mode,
    promptVersionBId,
  }))

  return c.json({ success: true, data: run }, 202)
})

// GET /api/v1/eval-runs?evaluatorId=...&promptVersionId=...&page=1&limit=50
//
// P3-17: pagination. The previous hard `.limit(50)` silently dropped older runs
// on busy workspaces. Returns { data, meta: { total, page, limit } } so the UI
// can render a real paginator. Defaults preserve the prior 50-row first page.
evalsRouter.get('/eval-runs', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  const evaluatorId = c.req.query('evaluatorId')
  const promptVersionId = c.req.query('promptVersionId')
  const { page, limit, offset } = parsePageLimit(c.req.query('page'), c.req.query('limit'))

  let query = supabaseAdmin
    .from('eval_runs')
    .select('*', { count: 'exact' })
    .eq('organization_id', orgId)
    .order('started_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (evaluatorId) query = query.eq('evaluator_id', evaluatorId)
  if (promptVersionId) query = query.eq('prompt_version_id', promptVersionId)

  const { data, error, count } = await query
  if (error) throw new ApiError('INTERNAL_ERROR', error.message)
  return c.json({ success: true, data: data ?? [], meta: { total: count ?? 0, page, limit } })
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

// GET /api/v1/eval-runs/:id/results?page=1&limit=50
//
// P3-17: pagination. The previous handler returned the whole result set (could
// be 1000 rows on a max-size run) — fine for the dashboard's "lowest 5" widget
// but a real waste over the wire. Same envelope as /eval-runs above.
evalsRouter.get('/eval-runs/:id/results', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  const runId = c.req.param('id')
  const { page, limit, offset } = parsePageLimit(c.req.query('page'), c.req.query('limit'))

  // Verify run belongs to org first (extra safety on top of RLS)
  const { data: run } = await supabaseAdmin
    .from('eval_runs')
    .select('id')
    .eq('id', runId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!run) throw new ApiError('NOT_FOUND', 'Eval run not found')

  const { data, error, count } = await supabaseAdmin
    .from('eval_results')
    .select('*', { count: 'exact' })
    .eq('eval_run_id', runId)
    .order('score', { ascending: true })
    .range(offset, offset + limit - 1)

  if (error) throw new ApiError('INTERNAL_ERROR', error.message)
  return c.json({ success: true, data: data ?? [], meta: { total: count ?? 0, page, limit } })
})

// POST /api/v1/eval-runs/estimate — cost estimate for a planned run
evalsRouter.post('/eval-runs/estimate', async (c) => {
  let body: {
    sampleSize?: unknown
    judgeProvider?: unknown
    judgeModel?: unknown
    criterionChars?: unknown
    avgResponseChars?: unknown
  }
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    throw new ApiError('INVALID_JSON_BODY', 'Invalid JSON body')
  }
  const sampleSize = typeof body.sampleSize === 'number' ? Math.round(body.sampleSize) : 50
  const judgeModel = typeof body.judgeModel === 'string' ? body.judgeModel : 'gpt-4o-mini'
  // P3-13: take the real provider from the caller instead of sniffing prefixes.
  // Default to 'openai' for back-compat with old callers that only sent judgeModel.
  const VALID_JUDGE_PROVIDERS = ['openai', 'anthropic', 'gemini', 'azure', 'mistral', 'openrouter'] as const
  type JudgeProvider = typeof VALID_JUDGE_PROVIDERS[number]
  const judgeProvider: JudgeProvider =
    typeof body.judgeProvider === 'string' && (VALID_JUDGE_PROVIDERS as readonly string[]).includes(body.judgeProvider)
      ? (body.judgeProvider as JudgeProvider)
      : 'openai'
  const criterionChars = typeof body.criterionChars === 'number' && body.criterionChars >= 0 ? body.criterionChars : undefined
  const avgResponseChars = typeof body.avgResponseChars === 'number' && body.avgResponseChars >= 0 ? body.avgResponseChars : undefined
  const estimateUsd = estimateJudgeCostUsd({
    sampleSize,
    judgeProvider,
    judgeModel,
    ...(criterionChars != null ? { criterionChars } : {}),
    ...(avgResponseChars != null ? { avgResponseChars } : {}),
  })
  return c.json({ success: true, data: { estimateUsd } })
})
