import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../middleware/authJwt.js'
import { supabaseAdmin } from '../lib/db.js'

export const humanEvalsRouter = new Hono<JwtContext>()

humanEvalsRouter.use('*', authJwt)

// ── Annotation queue ─────────────────────────────────────────────────────────

// GET /api/v1/annotation/queue
//   ?promptName=...           filter by prompt
//   &promptVersionId=...      filter by specific version
//   &unscoredOnly=true        only show requests not yet scored by current user
//   &lowJudgeScoreOnly=true   only show requests with eval_results.score < 0.5
//   &limit=50                 default 50, max 200
// Mounted at /api/v1 — full paths are /api/v1/annotation/queue, /api/v1/human-evals[/:id|/correlation]
humanEvalsRouter.get('/annotation/queue', async (c) => {
  const orgId = c.get('orgId')
  const userId = c.get('userId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const promptName = c.req.query('promptName')
  const promptVersionId = c.req.query('promptVersionId')
  const unscoredOnly = c.req.query('unscoredOnly') === 'true'
  const lowJudgeScoreOnly = c.req.query('lowJudgeScoreOnly') === 'true'
  const limit = Math.min(200, Math.max(1, parseInt(c.req.query('limit') ?? '50', 10)))

  // Build query: scope to requests that have a prompt_version_id (i.e. were
  // tagged with a prompt) and a response_body (otherwise there's nothing to
  // score). We fetch prompt_versions metadata in a separate query below
  // (avoids supabase-js's brittle inline-join type inference).
  let query = supabaseAdmin
    .from('requests')
    .select('id, prompt_version_id, model, created_at, request_body, response_body')
    .eq('organization_id', orgId)
    .not('prompt_version_id', 'is', null)
    .not('response_body', 'is', null)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (promptVersionId) query = query.eq('prompt_version_id', promptVersionId)

  if (promptName) {
    const { data: versions } = await supabaseAdmin
      .from('prompt_versions')
      .select('id')
      .eq('organization_id', orgId)
      .eq('name', promptName)
    const vids = (versions ?? []).map((v) => v.id)
    if (vids.length === 0) return c.json({ success: true, data: [] })
    query = query.in('prompt_version_id', vids)
  }

  const { data: requests, error } = await query
  if (error) return c.json({ error: error.message }, 500)
  if (!requests || requests.length === 0) {
    return c.json({ success: true, data: [] })
  }

  const requestIds = requests.map((r) => r.id)
  const versionIds = [...new Set(requests.map((r) => r.prompt_version_id).filter((v): v is string => !!v))]

  // Fetch prompt version metadata (name + version number)
  const pvMap = new Map<string, { name: string; version: number }>()
  if (versionIds.length > 0) {
    const { data: pvs } = await supabaseAdmin
      .from('prompt_versions')
      .select('id, name, version')
      .in('id', versionIds)
    for (const pv of pvs ?? []) {
      pvMap.set(pv.id, { name: pv.name, version: pv.version })
    }
  }

  // Existing human scores by this user (to mark/filter "already scored")
  const { data: existingHuman } = await supabaseAdmin
    .from('human_evals')
    .select('request_id, score, raw_score, comment')
    .in('request_id', requestIds)
    .eq('reviewer_id', userId ?? '')

  const humanMap = new Map<string, { score: number; raw_score: number | null; comment: string | null }>()
  for (const h of existingHuman ?? []) {
    humanMap.set(h.request_id as string, {
      score: h.score,
      raw_score: h.raw_score,
      comment: h.comment,
    })
  }

  // Most recent LLM judge score per request (for context + lowJudgeScoreOnly filter)
  const { data: evalResults } = await supabaseAdmin
    .from('eval_results')
    .select('request_id, score, created_at')
    .in('request_id', requestIds)
    .order('created_at', { ascending: false })

  const judgeMap = new Map<string, number>()
  for (const e of evalResults ?? []) {
    if (e.request_id && !judgeMap.has(e.request_id)) {
      judgeMap.set(e.request_id, e.score)
    }
  }

  let enriched = requests.map((r) => {
    const pv = r.prompt_version_id ? pvMap.get(r.prompt_version_id) : null
    return {
      id: r.id,
      prompt_version_id: r.prompt_version_id,
      prompt_name: pv?.name ?? null,
      prompt_version: pv?.version ?? null,
      model: r.model,
      created_at: r.created_at,
      request_body: r.request_body,
      response_body: r.response_body,
      llm_judge_score: judgeMap.get(r.id) ?? null,
      human_eval: humanMap.get(r.id) ?? null,
    }
  })

  if (unscoredOnly) {
    enriched = enriched.filter((r) => r.human_eval === null)
  }
  if (lowJudgeScoreOnly) {
    enriched = enriched.filter((r) => r.llm_judge_score != null && r.llm_judge_score < 0.5)
  }

  return c.json({ success: true, data: enriched })
})

// ── Human evals CRUD ────────────────────────────────────────────────────────

// POST /api/v1/human-evals — upsert (request_id, reviewer_id) score
humanEvalsRouter.post('/human-evals', async (c) => {
  const orgId = c.get('orgId')
  const userId = c.get('userId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)
  if (!userId) return c.json({ error: 'User not authenticated' }, 401)

  let body: { requestId?: unknown; score?: unknown; rawScore?: unknown; comment?: unknown }
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const requestId = typeof body.requestId === 'string' ? body.requestId.trim() : ''
  const score = typeof body.score === 'number' ? body.score : NaN
  const rawScore = typeof body.rawScore === 'number' ? body.rawScore : null
  const comment = typeof body.comment === 'string' ? body.comment.trim() || null : null

  if (!requestId) return c.json({ error: 'requestId is required' }, 400)
  if (!Number.isFinite(score) || score < 0 || score > 1) {
    return c.json({ error: 'score must be a number between 0 and 1' }, 400)
  }

  // Look up prompt_version_id for denormalized filter
  const { data: req } = await supabaseAdmin
    .from('requests')
    .select('id, prompt_version_id')
    .eq('id', requestId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!req) return c.json({ error: 'Request not found' }, 404)

  const { data, error } = await supabaseAdmin
    .from('human_evals')
    .upsert(
      {
        organization_id: orgId,
        request_id: requestId,
        prompt_version_id: req.prompt_version_id,
        reviewer_id: userId,
        score,
        raw_score: rawScore,
        comment,
      },
      { onConflict: 'request_id,reviewer_id' },
    )
    .select()
    .single()

  if (error || !data) {
    return c.json({ error: error?.message ?? 'Failed to save score' }, 500)
  }
  return c.json({ success: true, data })
})

// GET /api/v1/human-evals?promptVersionId=...
humanEvalsRouter.get('/human-evals', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const promptVersionId = c.req.query('promptVersionId')
  let query = supabaseAdmin
    .from('human_evals')
    .select('*')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
    .limit(200)

  if (promptVersionId) query = query.eq('prompt_version_id', promptVersionId)

  const { data, error } = await query
  if (error) return c.json({ error: error.message }, 500)
  return c.json({ success: true, data: data ?? [] })
})

// DELETE /api/v1/human-evals/:id
humanEvalsRouter.delete('/human-evals/:id', async (c) => {
  const orgId = c.get('orgId')
  const userId = c.get('userId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)
  if (!userId) return c.json({ error: 'User not authenticated' }, 401)

  const id = c.req.param('id')
  const { error } = await supabaseAdmin
    .from('human_evals')
    .delete()
    .eq('id', id)
    .eq('organization_id', orgId)
    .eq('reviewer_id', userId)

  if (error) return c.json({ error: error.message }, 500)
  return c.json({ success: true })
})

// GET /api/v1/human-evals/correlation?promptName=...&promptVersionId=...
// Returns per-request pairs (judge_score, human_score) for the matching scope.
// Client computes Pearson r. Server just provides paired data.
humanEvalsRouter.get('/human-evals/correlation', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const promptName = c.req.query('promptName')
  const promptVersionId = c.req.query('promptVersionId')

  // Resolve scope to prompt_version_ids
  let versionIds: string[] = []
  if (promptVersionId) {
    versionIds = [promptVersionId]
  } else if (promptName) {
    const { data: versions } = await supabaseAdmin
      .from('prompt_versions')
      .select('id')
      .eq('organization_id', orgId)
      .eq('name', promptName)
    versionIds = (versions ?? []).map((v) => v.id)
  }
  if (versionIds.length === 0) return c.json({ success: true, data: [] })

  // Pull human evals for those versions
  const { data: humans } = await supabaseAdmin
    .from('human_evals')
    .select('request_id, score')
    .in('prompt_version_id', versionIds)
  const humanMap = new Map<string, number>()
  for (const h of humans ?? []) {
    if (h.request_id) humanMap.set(h.request_id, h.score)
  }
  if (humanMap.size === 0) return c.json({ success: true, data: [] })

  // Most recent judge score per request
  const reqIds = [...humanMap.keys()]
  const { data: evalResults } = await supabaseAdmin
    .from('eval_results')
    .select('request_id, score, created_at')
    .in('request_id', reqIds)
    .order('created_at', { ascending: false })

  const judgeMap = new Map<string, number>()
  for (const e of evalResults ?? []) {
    if (e.request_id && !judgeMap.has(e.request_id)) {
      judgeMap.set(e.request_id, e.score)
    }
  }

  const pairs: Array<{ requestId: string; judgeScore: number; humanScore: number }> = []
  for (const [requestId, humanScore] of humanMap.entries()) {
    const judgeScore = judgeMap.get(requestId)
    if (judgeScore != null) {
      pairs.push({ requestId, judgeScore, humanScore })
    }
  }

  return c.json({ success: true, data: pairs })
})
