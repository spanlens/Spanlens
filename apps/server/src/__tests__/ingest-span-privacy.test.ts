import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { installOnError } from './helpers/install-on-error.js'

/**
 * SDK span ingest: what the server stores for span bodies and metadata.
 *
 *   1. input (span POST) and output / error_message (span PATCH) used to be
 *      stored exactly as the SDK sent them. They now go through the same API
 *      key masking and 64 KiB inline cap the `requests` row applies, so a key
 *      pasted into a prompt or echoed in a provider 401 is not persisted in
 *      clear, and one oversized payload cannot bloat the spans table.
 *
 *   2. PATCH metadata used to REPLACE the column. The SDKs send the caller's
 *      metadata on the span POST and a provider/model tag on the closing
 *      PATCH, so every successful span lost the caller's own keys (tenant ids
 *      and similar). The PATCH now shallow-merges into the stored object
 *      (new keys win) through the merge_span_metadata RPC, which does
 *      `metadata || patch` in a single statement.
 *
 * The DB mock follows the real Supabase contract: failures resolve to
 * `{ data, error }`, they never reject.
 */

const SPAN_UUID = '99999999-8888-4777-8666-555555555555'
const TRACE_UUID = '11111111-2222-4333-8444-555555555555'
const LEAKED_KEY = 'sk-proj-ABCDEFGHIJKLMNOPQRSTUV1234'

interface RpcCall {
  fn: string
  params: Record<string, unknown>
}

const state = vi.hoisted(() => ({
  spanInserts: [] as Array<Record<string, unknown>>,
  spanUpdates: [] as Array<Record<string, unknown>>,
  spanSelects: [] as string[],
  rpcCalls: [] as RpcCall[],
  /** What the merge RPC resolves to. */
  rpcResult: { data: true, error: null } as { data: unknown; error: { code?: string; message: string } | null },
  /** spans.metadata as currently stored, for the read-merge-write fallback. */
  storedMetadata: null as unknown,
  /** Whether the span row exists for the update/select snapshot. */
  spanExists: true,
}))

vi.mock('../middleware/authApiKey.js', () => ({
  authApiKey: async (c: { set: (k: string, v: unknown) => void }, next: () => Promise<void>) => {
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

vi.mock('../lib/wait-until.js', () => ({ fireAndForget: vi.fn() }))
vi.mock('../lib/webhook-emit.js', () => ({ emitWebhookEvent: vi.fn(async () => undefined) }))

vi.mock('../lib/db.js', () => {
  const snapshot = () => ({
    data: state.spanExists ? { id: SPAN_UUID, metadata: state.storedMetadata } : null,
    error: state.spanExists ? null : { message: 'no rows' },
  })

  const spanSelect = (cols: string) => {
    state.spanSelects.push(cols)
    const chain = {
      eq: () => chain,
      single: async () => {
        if (!state.spanExists) return { data: null, error: { message: 'no rows' } }
        if (cols === 'started_at') return { data: { started_at: '2026-09-28T00:00:00.000Z' }, error: null }
        if (cols === 'metadata') return { data: { metadata: state.storedMetadata }, error: null }
        return snapshot()
      },
    }
    return chain
  }

  const supabaseAdmin = {
    rpc: async (fn: string, params: Record<string, unknown>) => {
      state.rpcCalls.push({ fn, params })
      return state.rpcResult
    },
    from: (table: string) => {
      if (table === 'traces') {
        const chain = {
          eq: () => chain,
          single: async () => ({ data: { id: TRACE_UUID, project_id: 'project-1' }, error: null }),
        }
        return { select: () => chain }
      }
      if (table !== 'spans') throw new Error(`unexpected table: ${table}`)
      return {
        insert: (payload: Record<string, unknown>) => {
          state.spanInserts.push(payload)
          return {
            select: () => ({
              single: async () => ({ data: { id: SPAN_UUID, started_at: 'now' }, error: null }),
            }),
          }
        },
        select: (cols: string) => spanSelect(cols),
        update: (payload: Record<string, unknown>) => {
          state.spanUpdates.push(payload)
          const chain = {
            eq: () => chain,
            select: () => ({ single: async () => snapshot() }),
          }
          return chain
        },
      }
    },
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

function send(path: string, body: unknown, method: 'POST' | 'PATCH') {
  return buildApp().request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  state.spanInserts.length = 0
  state.spanUpdates.length = 0
  state.spanSelects.length = 0
  state.rpcCalls.length = 0
  state.rpcResult = { data: true, error: null }
  state.storedMetadata = null
  state.spanExists = true
})

// ── span bodies: masking + cap ───────────────────────────────────────────────

describe('POST /ingest/traces/:id/spans — input sanitization', () => {
  it('masks API keys inside a structured input and keeps its shape', async () => {
    const res = await send(
      `/ingest/traces/${TRACE_UUID}/spans`,
      { name: 'llm', input: { messages: [{ role: 'user', content: `key ${LEAKED_KEY}` }] } },
      'POST',
    )

    expect(res.status).toBe(201)
    expect(state.spanInserts[0]?.['input']).toEqual({
      messages: [{ role: 'user', content: 'key sk-proj-***' }],
    })
  })

  it('replaces an input above 64 KiB with the truncation envelope', async () => {
    await send(
      `/ingest/traces/${TRACE_UUID}/spans`,
      { name: 'llm', input: 'x'.repeat(70_000) },
      'POST',
    )

    const input = state.spanInserts[0]?.['input'] as Record<string, unknown>
    expect(input['_truncated']).toBe(true)
    expect(input['_original_size_bytes']).toBe(70_000)
  })

  it('keeps an explicit null input as null', async () => {
    await send(`/ingest/traces/${TRACE_UUID}/spans`, { name: 'llm', input: null }, 'POST')

    expect(state.spanInserts[0]?.['input']).toBeNull()
  })
})

describe('PATCH /ingest/spans/:id — output / error sanitization', () => {
  it('masks keys in a string output', async () => {
    const res = await send(`/ingest/spans/${SPAN_UUID}`, { output: `echo ${LEAKED_KEY}` }, 'PATCH')

    expect(res.status).toBe(200)
    expect(state.spanUpdates[0]?.['output']).toBe('echo sk-proj-***')
  })

  it('masks keys in an object output (full provider response)', async () => {
    await send(
      `/ingest/spans/${SPAN_UUID}`,
      { output: { choices: [{ message: { content: `AIza${'B'.repeat(35)}` } }] } },
      'PATCH',
    )

    expect(state.spanUpdates[0]?.['output']).toEqual({
      choices: [{ message: { content: 'AIza***' } }],
    })
  })

  it('caps an oversized output', async () => {
    await send(`/ingest/spans/${SPAN_UUID}`, { output: { blob: 'y'.repeat(70_000) } }, 'PATCH')

    const output = state.spanUpdates[0]?.['output'] as Record<string, unknown>
    expect(output['_truncated']).toBe(true)
  })

  it('masks keys in error_message (provider 401 echoes)', async () => {
    await send(
      `/ingest/spans/${SPAN_UUID}`,
      { status: 'error', error_message: `Incorrect API key provided: ${LEAKED_KEY}` },
      'PATCH',
    )

    expect(state.spanUpdates[0]?.['error_message']).toBe('Incorrect API key provided: sk-proj-***')
  })
})

// ── metadata merge ───────────────────────────────────────────────────────────

describe('PATCH /ingest/spans/:id — metadata is merged, not replaced', () => {
  it('merges through the RPC and leaves metadata out of the column update', async () => {
    const res = await send(
      `/ingest/spans/${SPAN_UUID}`,
      { status: 'completed', ended_at: '2026-09-28T00:00:01.000Z', metadata: { model: 'gpt-4o', provider: 'openai' } },
      'PATCH',
    )

    expect(res.status).toBe(200)
    expect(state.rpcCalls).toEqual([
      {
        fn: 'merge_span_metadata',
        params: {
          p_span_id: SPAN_UUID,
          p_organization_id: 'org-1',
          p_patch: { model: 'gpt-4o', provider: 'openai' },
        },
      },
    ])
    expect(state.spanUpdates[0]).not.toHaveProperty('metadata')
    expect(state.spanUpdates[0]?.['status']).toBe('completed')
  })

  it('a metadata-only PATCH merges and returns the row snapshot', async () => {
    state.storedMetadata = { tenant: 'acme', provider: 'openai' }

    const res = await send(`/ingest/spans/${SPAN_UUID}`, { metadata: { provider: 'openai' } }, 'PATCH')
    const json = (await res.json()) as { data: { metadata: unknown } }

    expect(res.status).toBe(200)
    expect(state.rpcCalls).toHaveLength(1)
    expect(state.spanUpdates).toHaveLength(0)
    expect(json.data.metadata).toEqual({ tenant: 'acme', provider: 'openai' })
  })

  it('returns 404 when the RPC reports no matching span in this org', async () => {
    state.rpcResult = { data: false, error: null }

    const res = await send(`/ingest/spans/${SPAN_UUID}`, { metadata: { provider: 'openai' } }, 'PATCH')

    expect(res.status).toBe(404)
    expect(state.spanUpdates).toHaveLength(0)
  })

  it('falls back to read-merge-write when the RPC is not deployed yet', async () => {
    state.rpcResult = {
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function public.merge_span_metadata' },
    }
    state.storedMetadata = { tenant: 'acme', model: 'stale' }
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const res = await send(
      `/ingest/spans/${SPAN_UUID}`,
      { status: 'completed', metadata: { model: 'llama3.2', provider: 'openai' } },
      'PATCH',
    )

    expect(res.status).toBe(200)
    expect(state.spanUpdates[0]?.['metadata']).toEqual({
      tenant: 'acme',
      model: 'llama3.2',
      provider: 'openai',
    })
  })

  it('an array metadata value still replaces (nothing to merge into)', async () => {
    await send(`/ingest/spans/${SPAN_UUID}`, { metadata: ['a', 'b'] }, 'PATCH')

    expect(state.rpcCalls).toHaveLength(0)
    expect(state.spanUpdates[0]?.['metadata']).toEqual(['a', 'b'])
  })

  it('a malformed span id is a 404 before any write', async () => {
    const res = await send('/ingest/spans/not-a-uuid', { metadata: { a: 1 } }, 'PATCH')

    expect(res.status).toBe(404)
    expect(state.rpcCalls).toHaveLength(0)
    expect(state.spanUpdates).toHaveLength(0)
  })
})
