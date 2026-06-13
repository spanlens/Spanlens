import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../middleware/authJwt.js'
import { supabaseAdmin } from '../lib/db.js'
import { runExperiment } from '../lib/experiment-runner.js'
import { fireAndForget } from '../lib/wait-until.js'
import { ApiError } from '../lib/errors.js'

export const experimentsRouter = new Hono<JwtContext>()

experimentsRouter.use('*', authJwt)

// POST /api/v1/experiments — create + kick off
experimentsRouter.post('/', async (c) => {
  const orgId = c.get('orgId')
  const userId = c.get('userId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  let body: {
    name?: unknown
    promptName?: unknown
    versionAId?: unknown
    versionBId?: unknown
    datasetId?: unknown
    evaluatorId?: unknown
    runProvider?: unknown
    runModel?: unknown
  }
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    throw new ApiError('INVALID_JSON_BODY', 'Invalid JSON body')
  }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const promptName = typeof body.promptName === 'string' ? body.promptName.trim() : ''
  const versionAId = typeof body.versionAId === 'string' ? body.versionAId.trim() : ''
  const versionBId = typeof body.versionBId === 'string' ? body.versionBId.trim() : ''
  const datasetId = typeof body.datasetId === 'string' ? body.datasetId.trim() : ''
  const evaluatorId = typeof body.evaluatorId === 'string' && body.evaluatorId.trim()
    ? body.evaluatorId.trim() : null
  const RUN_PROVIDERS = ['openai', 'anthropic', 'gemini', 'azure', 'mistral', 'openrouter'] as const
  type RunProvider = typeof RUN_PROVIDERS[number]
  const runProvider: RunProvider = (RUN_PROVIDERS as readonly string[]).includes(body.runProvider as string)
    ? (body.runProvider as RunProvider)
    : 'openai'
  const runModel = typeof body.runModel === 'string' ? body.runModel.trim() : ''

  if (!name) throw new ApiError('VALIDATION_FAILED', 'name is required')
  if (!promptName) throw new ApiError('VALIDATION_FAILED', 'promptName is required')
  if (!versionAId || !versionBId) throw new ApiError('BAD_REQUEST', 'versionAId and versionBId are required')
  if (versionAId === versionBId) throw new ApiError('BAD_REQUEST', 'versionA and versionB must differ')
  if (!datasetId) throw new ApiError('VALIDATION_FAILED', 'datasetId is required')
  if (!runModel) throw new ApiError('VALIDATION_FAILED', 'runModel is required')

  // Verify ownership
  const { data: versions } = await supabaseAdmin
    .from('prompt_versions')
    .select('id')
    .eq('organization_id', orgId)
    .in('id', [versionAId, versionBId])
  if (!versions || versions.length !== 2) {
    throw new ApiError('NOT_FOUND', 'Prompt versions not found')
  }

  const { data: dataset } = await supabaseAdmin
    .from('datasets')
    .select('id')
    .eq('id', datasetId)
    .eq('organization_id', orgId)
    .is('archived_at', null)
    .maybeSingle()
  if (!dataset) throw new ApiError('NOT_FOUND', 'Dataset not found')

  if (evaluatorId) {
    const { data: ev } = await supabaseAdmin
      .from('evaluators')
      .select('id')
      .eq('id', evaluatorId)
      .eq('organization_id', orgId)
      .is('archived_at', null)
      .maybeSingle()
    if (!ev) throw new ApiError('NOT_FOUND', 'Evaluator not found')
  }

  const { data: exp, error: expErr } = await supabaseAdmin
    .from('experiments')
    .insert({
      organization_id: orgId,
      name,
      prompt_name: promptName,
      version_a_id: versionAId,
      version_b_id: versionBId,
      dataset_id: datasetId,
      evaluator_id: evaluatorId,
      run_provider: runProvider,
      run_model: runModel,
      status: 'pending',
      created_by: userId ?? null,
    })
    .select()
    .single()

  if (expErr || !exp) {
    throw new ApiError('INTERNAL_ERROR', expErr?.message ?? 'Failed to create experiment')
  }

  fireAndForget(c, runExperiment({
    experimentId: exp.id,
    organizationId: orgId,
    versionAId,
    versionBId,
    datasetId,
    evaluatorId,
    runProvider,
    runModel,
  }))

  return c.json({ success: true, data: exp }, 202)
})

// GET /api/v1/experiments?promptName=...
experimentsRouter.get('/', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  const promptName = c.req.query('promptName')

  let query = supabaseAdmin
    .from('experiments')
    .select('*')
    .eq('organization_id', orgId)
    .order('started_at', { ascending: false })
    .limit(50)

  if (promptName) query = query.eq('prompt_name', promptName)

  const { data, error } = await query
  if (error) throw new ApiError('INTERNAL_ERROR', error.message)
  return c.json({ success: true, data: data ?? [] })
})

// GET /api/v1/experiments/:id
experimentsRouter.get('/:id', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  const id = c.req.param('id')
  const { data, error } = await supabaseAdmin
    .from('experiments')
    .select('*')
    .eq('id', id)
    .eq('organization_id', orgId)
    .maybeSingle()

  if (error || !data) throw new ApiError('NOT_FOUND', 'Experiment not found')
  return c.json({ success: true, data })
})

// GET /api/v1/experiments/:id/results
experimentsRouter.get('/:id/results', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  const id = c.req.param('id')

  // Verify ownership
  const { data: exp } = await supabaseAdmin
    .from('experiments')
    .select('id')
    .eq('id', id)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!exp) throw new ApiError('NOT_FOUND', 'Experiment not found')

  const { data, error } = await supabaseAdmin
    .from('experiment_results')
    .select('*, dataset_items(input, expected_output)')
    .eq('experiment_id', id)
    .order('created_at', { ascending: true })

  if (error) throw new ApiError('INTERNAL_ERROR', error.message)
  return c.json({ success: true, data: data ?? [] })
})
