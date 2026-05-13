import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../middleware/authJwt.js'
import { supabaseAdmin } from '../lib/db.js'

export const datasetsRouter = new Hono<JwtContext>()

datasetsRouter.use('*', authJwt)

// ── Datasets ────────────────────────────────────────────────────────────────

// POST /api/v1/datasets — create
datasetsRouter.post('/', async (c) => {
  const orgId = c.get('orgId')
  const userId = c.get('userId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  let body: { name?: unknown; description?: unknown }
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const description = typeof body.description === 'string' ? body.description.trim() : null
  if (!name) return c.json({ error: 'name is required' }, 400)

  const { data, error } = await supabaseAdmin
    .from('datasets')
    .insert({
      organization_id: orgId,
      name,
      description,
      created_by: userId ?? null,
    })
    .select()
    .single()

  if (error || !data) {
    if (error?.code === '23505') {
      return c.json({ error: 'A dataset with this name already exists' }, 409)
    }
    return c.json({ error: error?.message ?? 'Failed to create dataset' }, 500)
  }
  return c.json({ success: true, data }, 201)
})

// GET /api/v1/datasets — list (with item counts)
datasetsRouter.get('/', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const { data: datasets, error } = await supabaseAdmin
    .from('datasets')
    .select('*')
    .eq('organization_id', orgId)
    .is('archived_at', null)
    .order('created_at', { ascending: false })

  if (error) return c.json({ error: error.message }, 500)

  const datasetIds = (datasets ?? []).map((d) => d.id)
  if (datasetIds.length === 0) {
    return c.json({ success: true, data: [] })
  }

  // Count items per dataset (single round trip)
  const { data: counts } = await supabaseAdmin
    .from('dataset_items')
    .select('dataset_id')
    .in('dataset_id', datasetIds)

  const countMap = new Map<string, number>()
  for (const row of counts ?? []) {
    countMap.set(row.dataset_id, (countMap.get(row.dataset_id) ?? 0) + 1)
  }

  const enriched = (datasets ?? []).map((d) => ({
    ...d,
    item_count: countMap.get(d.id) ?? 0,
  }))

  return c.json({ success: true, data: enriched })
})

// GET /api/v1/datasets/:id — single dataset + items
datasetsRouter.get('/:id', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const id = c.req.param('id')

  const { data: dataset, error: dsErr } = await supabaseAdmin
    .from('datasets')
    .select('*')
    .eq('id', id)
    .eq('organization_id', orgId)
    .is('archived_at', null)
    .maybeSingle()

  if (dsErr || !dataset) return c.json({ error: 'Dataset not found' }, 404)

  const { data: items, error: itemsErr } = await supabaseAdmin
    .from('dataset_items')
    .select('*')
    .eq('dataset_id', id)
    .order('created_at', { ascending: false })

  if (itemsErr) return c.json({ error: itemsErr.message }, 500)

  return c.json({ success: true, data: { ...dataset, items: items ?? [] } })
})

// DELETE /api/v1/datasets/:id — soft delete (archive)
datasetsRouter.delete('/:id', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const id = c.req.param('id')
  const { error } = await supabaseAdmin
    .from('datasets')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id)
    .eq('organization_id', orgId)

  if (error) return c.json({ error: error.message }, 500)
  return c.json({ success: true })
})

// ── Dataset items ──────────────────────────────────────────────────────────

// POST /api/v1/datasets/:id/items — add a single item
datasetsRouter.post('/:id/items', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const datasetId = c.req.param('id')

  // Verify ownership
  const { data: ds } = await supabaseAdmin
    .from('datasets')
    .select('id')
    .eq('id', datasetId)
    .eq('organization_id', orgId)
    .is('archived_at', null)
    .maybeSingle()
  if (!ds) return c.json({ error: 'Dataset not found' }, 404)

  let body: { input?: unknown; expectedOutput?: unknown; sourceRequestId?: unknown }
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  if (!body.input || typeof body.input !== 'object' || Array.isArray(body.input)) {
    return c.json({ error: 'input must be an object' }, 400)
  }
  const input = body.input as Record<string, unknown>
  // Accept shapes: { variables: {...} } or { messages: [...] }
  const hasVars = input.variables && typeof input.variables === 'object'
  const hasMsgs = Array.isArray(input.messages)
  if (!hasVars && !hasMsgs) {
    return c.json({ error: 'input must contain "variables" object or "messages" array' }, 400)
  }

  const expectedOutput = typeof body.expectedOutput === 'string' ? body.expectedOutput : null
  const sourceRequestId = typeof body.sourceRequestId === 'string' ? body.sourceRequestId : null

  const { data, error } = await supabaseAdmin
    .from('dataset_items')
    .insert({
      organization_id: orgId,
      dataset_id: datasetId,
      input: input as Record<string, unknown>,
      expected_output: expectedOutput,
      source_request_id: sourceRequestId,
    })
    .select()
    .single()

  if (error || !data) return c.json({ error: error?.message ?? 'Failed to add item' }, 500)
  return c.json({ success: true, data }, 201)
})

// POST /api/v1/datasets/:id/items/import-requests — bulk import from production
datasetsRouter.post('/:id/items/import-requests', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const datasetId = c.req.param('id')

  const { data: ds } = await supabaseAdmin
    .from('datasets')
    .select('id')
    .eq('id', datasetId)
    .eq('organization_id', orgId)
    .is('archived_at', null)
    .maybeSingle()
  if (!ds) return c.json({ error: 'Dataset not found' }, 404)

  let body: { requestIds?: unknown }
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  if (!Array.isArray(body.requestIds) || body.requestIds.length === 0) {
    return c.json({ error: 'requestIds (array) is required' }, 400)
  }
  const ids = body.requestIds.filter((x): x is string => typeof x === 'string').slice(0, 200)
  if (ids.length === 0) return c.json({ error: 'No valid request IDs' }, 400)

  // Fetch source requests
  const { data: requests, error: reqErr } = await supabaseAdmin
    .from('requests')
    .select('id, request_body, response_body')
    .in('id', ids)
    .eq('organization_id', orgId)

  if (reqErr) return c.json({ error: reqErr.message }, 500)
  if (!requests || requests.length === 0) {
    return c.json({ error: 'No matching requests found' }, 404)
  }

  // Build dataset_items rows. We try to extract the user message + final response.
  const rows = requests.map((r) => {
    const reqBody = r.request_body as Record<string, unknown> | null
    const messages = Array.isArray(reqBody?.messages) ? reqBody.messages : null
    const input = messages
      ? { messages }
      : { variables: {} }

    const responseBody = r.response_body as Record<string, unknown> | null
    let expectedOutput: string | null = null
    if (responseBody) {
      // OpenAI shape
      const choices = responseBody.choices as Array<Record<string, unknown>> | undefined
      if (Array.isArray(choices) && choices[0]) {
        const msg = choices[0].message as Record<string, unknown> | undefined
        if (typeof msg?.content === 'string') expectedOutput = msg.content
      }
      // Anthropic shape
      if (!expectedOutput) {
        const content = responseBody.content as Array<Record<string, unknown>> | undefined
        if (Array.isArray(content)) {
          const textBlock = content.find((b) => b.type === 'text')
          if (textBlock && typeof textBlock.text === 'string') expectedOutput = textBlock.text
        }
      }
    }

    return {
      organization_id: orgId,
      dataset_id: datasetId,
      input,
      expected_output: expectedOutput,
      source_request_id: r.id,
    }
  })

  const { data, error } = await supabaseAdmin
    .from('dataset_items')
    .insert(rows)
    .select()

  if (error) return c.json({ error: error.message }, 500)
  return c.json({ success: true, data: { imported: data?.length ?? 0 } }, 201)
})

// DELETE /api/v1/datasets/:id/items/:itemId
datasetsRouter.delete('/:id/items/:itemId', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const itemId = c.req.param('itemId')
  const { error } = await supabaseAdmin
    .from('dataset_items')
    .delete()
    .eq('id', itemId)
    .eq('organization_id', orgId)

  if (error) return c.json({ error: error.message }, 500)
  return c.json({ success: true })
})
