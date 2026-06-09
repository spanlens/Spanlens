import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../middleware/authJwt.js'
import { supabaseAdmin } from '../lib/db.js'
import { requestsScope, selectRequests } from '../lib/requests-query.js'
import { ApiError } from '../lib/errors.js'

export const datasetsRouter = new Hono<JwtContext>()

datasetsRouter.use('*', authJwt)

// ── Datasets ────────────────────────────────────────────────────────────────

// POST /api/v1/datasets — create
datasetsRouter.post('/', async (c) => {
  const orgId = c.get('orgId')
  const userId = c.get('userId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  let body: { name?: unknown; description?: unknown }
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    throw new ApiError('INVALID_JSON_BODY', 'Invalid JSON body')
  }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const description = typeof body.description === 'string' ? body.description.trim() : null
  if (!name) throw new ApiError('VALIDATION_FAILED', 'name is required')

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
      throw new ApiError('CONFLICT', 'A dataset with this name already exists')
    }
    throw new ApiError('INTERNAL_ERROR', error?.message ?? 'Failed to create dataset')
  }
  return c.json({ success: true, data }, 201)
})

// GET /api/v1/datasets — list (with item counts)
datasetsRouter.get('/', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  const { data: datasets, error } = await supabaseAdmin
    .from('datasets')
    .select('*')
    .eq('organization_id', orgId)
    .is('archived_at', null)
    .order('created_at', { ascending: false })

  if (error) throw new ApiError('INTERNAL_ERROR', error.message)

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
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  const id = c.req.param('id')

  const { data: dataset, error: dsErr } = await supabaseAdmin
    .from('datasets')
    .select('*')
    .eq('id', id)
    .eq('organization_id', orgId)
    .is('archived_at', null)
    .maybeSingle()

  if (dsErr || !dataset) throw new ApiError('NOT_FOUND', 'Dataset not found')

  const { data: items, error: itemsErr } = await supabaseAdmin
    .from('dataset_items')
    .select('*')
    .eq('dataset_id', id)
    .order('created_at', { ascending: false })

  if (itemsErr) throw new ApiError('INTERNAL_ERROR', itemsErr.message)

  return c.json({ success: true, data: { ...dataset, items: items ?? [] } })
})

// DELETE /api/v1/datasets/:id — soft delete (archive)
datasetsRouter.delete('/:id', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  const id = c.req.param('id')
  const { error } = await supabaseAdmin
    .from('datasets')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id)
    .eq('organization_id', orgId)

  if (error) throw new ApiError('INTERNAL_ERROR', error.message)
  return c.json({ success: true })
})

// ── Dataset items ──────────────────────────────────────────────────────────

// POST /api/v1/datasets/:id/items — add a single item
datasetsRouter.post('/:id/items', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  const datasetId = c.req.param('id')

  // Verify ownership
  const { data: ds } = await supabaseAdmin
    .from('datasets')
    .select('id')
    .eq('id', datasetId)
    .eq('organization_id', orgId)
    .is('archived_at', null)
    .maybeSingle()
  if (!ds) throw new ApiError('NOT_FOUND', 'Dataset not found')

  let body: { input?: unknown; expectedOutput?: unknown; sourceRequestId?: unknown }
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    throw new ApiError('INVALID_JSON_BODY', 'Invalid JSON body')
  }

  if (!body.input || typeof body.input !== 'object' || Array.isArray(body.input)) {
    throw new ApiError('VALIDATION_FAILED', 'input must be an object')
  }
  const input = body.input as Record<string, unknown>
  // Accept shapes: { variables: {...} } or { messages: [...] }
  const hasVars = input.variables && typeof input.variables === 'object'
  const hasMsgs = Array.isArray(input.messages)
  if (!hasVars && !hasMsgs) {
    throw new ApiError('VALIDATION_FAILED', 'input must contain "variables" object or "messages" array')
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

  if (error || !data) throw new ApiError('INTERNAL_ERROR', error?.message ?? 'Failed to add item')
  return c.json({ success: true, data }, 201)
})

// POST /api/v1/datasets/:id/items/bulk — bulk INSERT of items uploaded
// from a client-side parsed file (JSON / CSV). Treats each row as an
// independent item; partial-failure surfaced with per-row status so the UI
// can show "8/10 inserted, 2 skipped (missing input)".
datasetsRouter.post('/:id/items/bulk', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  const datasetId = c.req.param('id')

  // Verify ownership (same pattern as POST /items)
  const { data: ds } = await supabaseAdmin
    .from('datasets')
    .select('id')
    .eq('id', datasetId)
    .eq('organization_id', orgId)
    .is('archived_at', null)
    .maybeSingle()
  if (!ds) throw new ApiError('NOT_FOUND', 'Dataset not found')

  let body: { items?: unknown }
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    throw new ApiError('INVALID_JSON_BODY', 'Invalid JSON body')
  }

  if (!Array.isArray(body.items)) {
    throw new ApiError('VALIDATION_FAILED', 'items must be an array')
  }
  if (body.items.length === 0) {
    throw new ApiError('BAD_REQUEST', 'items array is empty')
  }
  // Cap per-request size to keep payload + memory bounded. Most uploads
  // are <1000 rows in practice.
  if (body.items.length > 5000) {
    throw new ApiError('VALIDATION_FAILED', 'items array too large (max 5000)')
  }

  // Normalize each row to the schema enforced by single-item POST:
  // input must be an object containing `variables` or `messages`.
  const rows: { organization_id: string; dataset_id: string; input: Record<string, unknown>; expected_output: string | null }[] = []
  const skipped: { index: number; reason: string }[] = []

  for (let i = 0; i < body.items.length; i++) {
    const raw = body.items[i] as Record<string, unknown> | undefined
    if (!raw || typeof raw !== 'object') {
      skipped.push({ index: i, reason: 'not an object' })
      continue
    }

    const rawInput = raw['input']
    let input: Record<string, unknown> | null = null

    if (typeof rawInput === 'string') {
      // Plain-text input → wrap as a single user message so it fits the
      // schema. Most common shape for CSV uploads.
      input = { messages: [{ role: 'user', content: rawInput }] }
    } else if (rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput)) {
      const obj = rawInput as Record<string, unknown>
      const hasVars = obj['variables'] && typeof obj['variables'] === 'object'
      const hasMsgs = Array.isArray(obj['messages'])
      if (hasVars || hasMsgs) input = obj
    }

    if (!input) {
      skipped.push({ index: i, reason: 'input missing or invalid shape' })
      continue
    }

    const expected = raw['expected_output'] ?? raw['expectedOutput']
    rows.push({
      organization_id: orgId,
      dataset_id: datasetId,
      input,
      expected_output: typeof expected === 'string' ? expected : null,
    })
  }

  if (rows.length === 0) {
    return c.json({ error: 'No valid items in upload', skipped }, 400)
  }

  const { error } = await supabaseAdmin.from('dataset_items').insert(rows)
  if (error) throw new ApiError('INTERNAL_ERROR', error.message)

  return c.json({ success: true, data: { inserted: rows.length, skipped } }, 201)
})

// POST /api/v1/datasets/:id/items/import-requests — bulk import from production
datasetsRouter.post('/:id/items/import-requests', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  const datasetId = c.req.param('id')

  const { data: ds } = await supabaseAdmin
    .from('datasets')
    .select('id')
    .eq('id', datasetId)
    .eq('organization_id', orgId)
    .is('archived_at', null)
    .maybeSingle()
  if (!ds) throw new ApiError('NOT_FOUND', 'Dataset not found')

  let body: { requestIds?: unknown }
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    throw new ApiError('INVALID_JSON_BODY', 'Invalid JSON body')
  }

  if (!Array.isArray(body.requestIds) || body.requestIds.length === 0) {
    throw new ApiError('VALIDATION_FAILED', 'requestIds (array) is required')
  }
  const ids = body.requestIds.filter((x): x is string => typeof x === 'string').slice(0, 200)
  if (ids.length === 0) throw new ApiError('BAD_REQUEST', 'No valid request IDs')

  // Fetch source requests from ClickHouse. body columns are JSON strings —
  // parse at the boundary so the existing extraction logic stays unchanged.
  interface SourceRow {
    id: string
    request_body: string
    response_body: string
  }
  let rawRequests: SourceRow[]
  try {
    const scope = await requestsScope(orgId)
    rawRequests = await selectRequests<SourceRow>({
      scope,
      select: 'id, request_body, response_body',
      filters: 'id IN {ids:Array(UUID)}',
      params: { ids },
    })
  } catch (err) {
    throw new ApiError('INTERNAL_ERROR', err instanceof Error ? err.message : 'ClickHouse query failed')
  }
  if (rawRequests.length === 0) {
    throw new ApiError('NOT_FOUND', 'No matching requests found')
  }
  const requests = rawRequests.map((r) => {
    const parse = (s: string): Record<string, unknown> | null => {
      if (!s) return null
      try { return JSON.parse(s) as Record<string, unknown> } catch { return null }
    }
    return {
      id: r.id,
      request_body: parse(r.request_body),
      response_body: parse(r.response_body),
    }
  })

  // Build dataset_items rows. We try to extract the user message + final response.
  const rows = requests.map((r) => {
    const reqBody = r.request_body
    const messages = Array.isArray(reqBody?.messages) ? reqBody.messages : null
    const input = messages
      ? { messages }
      : { variables: {} }

    const responseBody = r.response_body
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

  if (error) throw new ApiError('INTERNAL_ERROR', error.message)
  return c.json({ success: true, data: { imported: data?.length ?? 0 } }, 201)
})

// DELETE /api/v1/datasets/:id/items/:itemId
datasetsRouter.delete('/:id/items/:itemId', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  const itemId = c.req.param('itemId')
  const { error } = await supabaseAdmin
    .from('dataset_items')
    .delete()
    .eq('id', itemId)
    .eq('organization_id', orgId)

  if (error) throw new ApiError('INTERNAL_ERROR', error.message)
  return c.json({ success: true })
})
