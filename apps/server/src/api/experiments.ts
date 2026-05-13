import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../middleware/authJwt.js'
import { supabaseAdmin } from '../lib/db.js'
import { runExperiment } from '../lib/experiment-runner.js'
import { fireAndForget } from '../lib/wait-until.js'

export const experimentsRouter = new Hono<JwtContext>()

experimentsRouter.use('*', authJwt)

// POST /api/v1/experiments — create + kick off
experimentsRouter.post('/', async (c) => {
  const orgId = c.get('orgId')
  const userId = c.get('userId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

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
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const promptName = typeof body.promptName === 'string' ? body.promptName.trim() : ''
  const versionAId = typeof body.versionAId === 'string' ? body.versionAId.trim() : ''
  const versionBId = typeof body.versionBId === 'string' ? body.versionBId.trim() : ''
  const datasetId = typeof body.datasetId === 'string' ? body.datasetId.trim() : ''
  const evaluatorId = typeof body.evaluatorId === 'string' && body.evaluatorId.trim()
    ? body.evaluatorId.trim() : null
  const runProvider = body.runProvider === 'anthropic' ? 'anthropic' : 'openai'
  const runModel = typeof body.runModel === 'string' ? body.runModel.trim() : ''

  if (!name) return c.json({ error: 'name is required' }, 400)
  if (!promptName) return c.json({ error: 'promptName is required' }, 400)
  if (!versionAId || !versionBId) return c.json({ error: 'versionAId and versionBId are required' }, 400)
  if (versionAId === versionBId) return c.json({ error: 'versionA and versionB must differ' }, 400)
  if (!datasetId) return c.json({ error: 'datasetId is required' }, 400)
  if (!runModel) return c.json({ error: 'runModel is required' }, 400)

  // Verify ownership
  const { data: versions } = await supabaseAdmin
    .from('prompt_versions')
    .select('id')
    .eq('organization_id', orgId)
    .in('id', [versionAId, versionBId])
  if (!versions || versions.length !== 2) {
    return c.json({ error: 'Prompt versions not found' }, 404)
  }

  const { data: dataset } = await supabaseAdmin
    .from('datasets')
    .select('id')
    .eq('id', datasetId)
    .eq('organization_id', orgId)
    .is('archived_at', null)
    .maybeSingle()
  if (!dataset) return c.json({ error: 'Dataset not found' }, 404)

  if (evaluatorId) {
    const { data: ev } = await supabaseAdmin
      .from('evaluators')
      .select('id')
      .eq('id', evaluatorId)
      .eq('organization_id', orgId)
      .is('archived_at', null)
      .maybeSingle()
    if (!ev) return c.json({ error: 'Evaluator not found' }, 404)
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
    return c.json({ error: expErr?.message ?? 'Failed to create experiment' }, 500)
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
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const promptName = c.req.query('promptName')

  let query = supabaseAdmin
    .from('experiments')
    .select('*')
    .eq('organization_id', orgId)
    .order('started_at', { ascending: false })
    .limit(50)

  if (promptName) query = query.eq('prompt_name', promptName)

  const { data, error } = await query
  if (error) return c.json({ error: error.message }, 500)
  return c.json({ success: true, data: data ?? [] })
})

// GET /api/v1/experiments/:id
experimentsRouter.get('/:id', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const id = c.req.param('id')
  const { data, error } = await supabaseAdmin
    .from('experiments')
    .select('*')
    .eq('id', id)
    .eq('organization_id', orgId)
    .maybeSingle()

  if (error || !data) return c.json({ error: 'Experiment not found' }, 404)
  return c.json({ success: true, data })
})

// GET /api/v1/experiments/:id/results
experimentsRouter.get('/:id/results', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const id = c.req.param('id')

  // Verify ownership
  const { data: exp } = await supabaseAdmin
    .from('experiments')
    .select('id')
    .eq('id', id)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!exp) return c.json({ error: 'Experiment not found' }, 404)

  const { data, error } = await supabaseAdmin
    .from('experiment_results')
    .select('*, dataset_items(input, expected_output)')
    .eq('experiment_id', id)
    .order('created_at', { ascending: true })

  if (error) return c.json({ error: error.message }, 500)
  return c.json({ success: true, data: data ?? [] })
})
