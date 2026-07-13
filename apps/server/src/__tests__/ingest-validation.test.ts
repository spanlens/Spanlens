import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { installOnError } from './helpers/install-on-error.js'

/**
 * 2026-07-13 audit fixes for the SDK ingest router:
 *
 *   1. Client-supplied `id` / `parent_span_id` / `request_id` (UUIDs) and
 *      `started_at` / `ended_at` (dates) are validated at the boundary.
 *      Malformed values used to reach Postgres, fail there, and surface as a
 *      500 INTERNAL_ERROR carrying the raw PG error message. They are body
 *      fields (not path params), so the contract is 400 VALIDATION_FAILED.
 *
 *   2. The file header promises idempotency via client-generated UUIDs, but
 *      re-POSTing the same id hit a PG unique violation (23505) → 500. The
 *      handlers now detect 23505 and return 200 with the existing row.
 *
 *   3. Raw PG error messages are never leaked in responses — they are logged
 *      server-side only.
 */

const PG_DUPLICATE_MESSAGE = 'duplicate key value violates unique constraint "traces_pkey"'
const PG_GENERIC_MESSAGE = 'insert or update on table violates something internal'

const TRACE_UUID = '11111111-2222-4333-8444-555555555555'
const SPAN_UUID = '99999999-8888-4777-8666-555555555555'

const state = vi.hoisted(() => ({
  /** Queue of results returned by `.insert(...).select(...).single()`. */
  insertResults: [] as Array<{
    data: Record<string, unknown> | null
    error: { message: string; code?: string } | null
  }>,
  /** Queue of results returned by `.select(...).eq(...)....single()`. */
  selectResults: [] as Array<{
    data: Record<string, unknown> | null
    error: { message: string } | null
  }>,
  /** Captured INSERT payloads, in call order. */
  insertCalls: [] as Array<{ table: string; payload: unknown }>,
}))

vi.mock('../middleware/authApiKey.js', () => ({
  authApiKey: async (
    c: { set: (k: string, v: unknown) => void },
    next: () => Promise<void>,
  ) => {
    c.set('organizationId', 'org-1')
    c.set('projectId', 'project-1')
    c.set('apiKeyId', 'apikey-1')
    await next()
  },
}))

vi.mock('../middleware/requireFullScope.js', () => ({
  requireFullScope: async (_c: unknown, next: () => Promise<void>) => {
    await next()
  },
}))

vi.mock('../lib/events-writer.js', () => ({
  writeTraceAsEvent: vi.fn(async () => undefined),
  writeSpanAsEvent: vi.fn(async () => undefined),
}))

vi.mock('../lib/wait-until.js', () => ({
  fireAndForget: vi.fn(),
}))

vi.mock('../lib/webhook-emit.js', () => ({
  emitWebhookEvent: vi.fn(async () => undefined),
}))

vi.mock('../lib/db.js', () => {
  const makeSelectChain = () => {
    const chain: {
      eq: () => unknown
      single: () => Promise<unknown>
    } = {
      eq: () => chain,
      single: async () => state.selectResults.shift() ?? { data: null, error: null },
    }
    return chain
  }
  const supabaseAdmin = {
    from: (table: string) => ({
      insert: (payload: unknown) => {
        state.insertCalls.push({ table, payload })
        return {
          select: () => ({
            single: async () =>
              state.insertResults.shift() ?? {
                data: null,
                error: { message: 'unexpected insert (no queued result)' },
              },
          }),
        }
      },
      select: () => makeSelectChain(),
      update: () => ({
        eq: () => ({
          eq: () => ({
            select: () => ({
              single: async () => state.selectResults.shift() ?? { data: null, error: null },
            }),
          }),
        }),
      }),
    }),
  }
  return { supabaseAdmin, supabaseClient: {} }
})

import { ingestRouter } from '../api/ingest.js'

function buildApp() {
  const app = new Hono()
  app.route('/ingest', ingestRouter)
  installOnError(app)
  return app
}

function postJson(app: Hono, path: string, body: unknown, method = 'POST') {
  return app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  state.insertResults.length = 0
  state.selectResults.length = 0
  state.insertCalls.length = 0
})

// ── POST /ingest/traces ───────────────────────────────────────────────────────

describe('POST /ingest/traces — boundary validation', () => {
  it('rejects a malformed client-supplied id with 400 VALIDATION_FAILED before touching the DB', async () => {
    const app = buildApp()
    const res = await postJson(app, '/ingest/traces', { name: 't', id: 'not-a-uuid' })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('VALIDATION_FAILED')
    expect(body.error.message).toContain('id')
    expect(state.insertCalls).toHaveLength(0)
  })

  it('rejects an unparseable started_at with 400 VALIDATION_FAILED', async () => {
    const app = buildApp()
    const res = await postJson(app, '/ingest/traces', { name: 't', started_at: 'yesterday-ish' })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('VALIDATION_FAILED')
    expect(state.insertCalls).toHaveLength(0)
  })

  it('accepts a valid client UUID + ISO date (201)', async () => {
    state.insertResults.push({
      data: { id: TRACE_UUID, started_at: '2026-07-13T00:00:00.000Z' },
      error: null,
    })
    const app = buildApp()
    const res = await postJson(app, '/ingest/traces', {
      name: 't',
      id: TRACE_UUID,
      started_at: '2026-07-13T00:00:00.000Z',
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { success: boolean; data: { id: string } }
    expect(body.success).toBe(true)
    expect(body.data.id).toBe(TRACE_UUID)
  })
})

describe('POST /ingest/traces — idempotent replay on duplicate id', () => {
  it('returns 200 with the existing row when the INSERT hits PG 23505', async () => {
    state.insertResults.push({
      data: null,
      error: { message: PG_DUPLICATE_MESSAGE, code: '23505' },
    })
    // Idempotency lookup finds the previously created trace.
    state.selectResults.push({
      data: { id: TRACE_UUID, started_at: '2026-07-13T00:00:00.000Z' },
      error: null,
    })
    const app = buildApp()
    const res = await postJson(app, '/ingest/traces', { name: 't', id: TRACE_UUID })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { success: boolean; data: { id: string } }
    expect(body.success).toBe(true)
    expect(body.data.id).toBe(TRACE_UUID)
  })

  it('still 500s (generic, no PG message) when 23505 fires but the row is not visible to this org', async () => {
    state.insertResults.push({
      data: null,
      error: { message: PG_DUPLICATE_MESSAGE, code: '23505' },
    })
    state.selectResults.push({ data: null, error: { message: 'not found' } })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const app = buildApp()
    const res = await postJson(app, '/ingest/traces', { name: 't', id: TRACE_UUID })
    expect(res.status).toBe(500)
    const text = await res.text()
    expect(text).not.toContain('duplicate key')
    expect(text).not.toContain('traces_pkey')
    consoleError.mockRestore()
  })
})

describe('POST /ingest/traces — no PG error message leak', () => {
  it('returns a generic 500 body and logs the PG message server-side instead', async () => {
    state.insertResults.push({
      data: null,
      error: { message: PG_GENERIC_MESSAGE, code: '23502' },
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const app = buildApp()
    const res = await postJson(app, '/ingest/traces', { name: 't' })
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: { code: string; message: string; details?: unknown } }
    expect(body.error.code).toBe('INTERNAL_ERROR')
    expect(body.error.message).toBe('Failed to create trace')
    expect(JSON.stringify(body)).not.toContain(PG_GENERIC_MESSAGE)
    // The message must still be observable server-side for debugging.
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('[ingest]'),
      expect.stringContaining(PG_GENERIC_MESSAGE),
    )
    consoleError.mockRestore()
  })
})

// ── PATCH /ingest/traces/:id ──────────────────────────────────────────────────

describe('PATCH /ingest/traces/:id — boundary validation', () => {
  it('rejects an unparseable ended_at with 400 VALIDATION_FAILED', async () => {
    const app = buildApp()
    const res = await postJson(
      app,
      `/ingest/traces/${TRACE_UUID}`,
      { status: 'completed', ended_at: 'garbage-date' },
      'PATCH',
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('VALIDATION_FAILED')
    expect(body.error.message).toContain('ended_at')
  })
})

// ── POST /ingest/traces/:id/spans ─────────────────────────────────────────────

describe('POST /ingest/traces/:id/spans — boundary validation', () => {
  function queueTraceOwnership() {
    state.selectResults.push({
      data: { id: TRACE_UUID, project_id: 'project-1' },
      error: null,
    })
  }

  it('rejects a malformed parent_span_id with 400 VALIDATION_FAILED before the INSERT', async () => {
    queueTraceOwnership()
    const app = buildApp()
    const res = await postJson(app, `/ingest/traces/${TRACE_UUID}/spans`, {
      name: 's',
      parent_span_id: 'nope',
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('VALIDATION_FAILED')
    expect(body.error.message).toContain('parent_span_id')
    expect(state.insertCalls).toHaveLength(0)
  })

  it('rejects a malformed request_id with 400 VALIDATION_FAILED', async () => {
    queueTraceOwnership()
    const app = buildApp()
    const res = await postJson(app, `/ingest/traces/${TRACE_UUID}/spans`, {
      name: 's',
      request_id: '12345',
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('VALIDATION_FAILED')
    expect(state.insertCalls).toHaveLength(0)
  })

  it('returns 200 with the existing row when a duplicate span id hits PG 23505', async () => {
    queueTraceOwnership()
    state.insertResults.push({
      data: null,
      error: { message: PG_DUPLICATE_MESSAGE, code: '23505' },
    })
    state.selectResults.push({
      data: { id: SPAN_UUID, started_at: '2026-07-13T00:00:01.000Z' },
      error: null,
    })
    const app = buildApp()
    const res = await postJson(app, `/ingest/traces/${TRACE_UUID}/spans`, {
      name: 's',
      id: SPAN_UUID,
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { success: boolean; data: { id: string } }
    expect(body.success).toBe(true)
    expect(body.data.id).toBe(SPAN_UUID)
  })

  it('span INSERT failure returns a generic 500 without the PG message', async () => {
    queueTraceOwnership()
    state.insertResults.push({
      data: null,
      error: { message: PG_GENERIC_MESSAGE, code: '23502' },
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const app = buildApp()
    const res = await postJson(app, `/ingest/traces/${TRACE_UUID}/spans`, { name: 's' })
    expect(res.status).toBe(500)
    const text = await res.text()
    expect(text).toContain('Failed to create span')
    expect(text).not.toContain(PG_GENERIC_MESSAGE)
    consoleError.mockRestore()
  })
})

// ── PATCH /ingest/spans/:id ───────────────────────────────────────────────────

describe('PATCH /ingest/spans/:id — boundary validation', () => {
  it('rejects an unparseable ended_at with 400 VALIDATION_FAILED', async () => {
    const app = buildApp()
    const res = await postJson(
      app,
      `/ingest/spans/${SPAN_UUID}`,
      { status: 'completed', ended_at: 'not a date at all zzz' },
      'PATCH',
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('VALIDATION_FAILED')
  })

  it('rejects a malformed request_id with 400 VALIDATION_FAILED', async () => {
    const app = buildApp()
    const res = await postJson(
      app,
      `/ingest/spans/${SPAN_UUID}`,
      { request_id: 'req_abc' },
      'PATCH',
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('VALIDATION_FAILED')
    expect(body.error.message).toContain('request_id')
  })
})
