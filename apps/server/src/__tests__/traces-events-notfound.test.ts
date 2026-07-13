import { describe, expect, test, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { installOnError } from './helpers/install-on-error.js'

/**
 * 2026-07-13 audit: on the events read path, GET /api/v1/traces/:id threw
 * ApiError NOT_FOUND *inside* the try block when the trace didn't exist, and
 * the surrounding catch logged "[traces:detail] events path failed" and fell
 * back to Postgres. Every lookup of a nonexistent trace therefore emitted a
 * fake failure log (polluting incident triage) and issued two pointless
 * Postgres queries. The fix rethrows NOT_FOUND from the catch; only
 * unexpected errors trigger the Postgres fallback.
 */

const state = vi.hoisted(() => ({
  fromCalls: [] as string[],
}))

const eventsMocks = vi.hoisted(() => ({
  listTracesFromEvents: vi.fn(),
  getTraceWithSpansFromEvents: vi.fn(),
}))

vi.mock('../middleware/authJwtOrApiKey.js', () => ({
  // Pass-through auth that just scopes the request to a fixed org.
  authJwtOrApiKey: async (
    c: { set: (k: string, v: unknown) => void },
    next: () => Promise<void>,
  ) => {
    c.set('orgId', 'org-1')
    await next()
  },
}))

vi.mock('../lib/events-read-flag.js', () => ({
  useEventsForTraces: async () => true,
}))

vi.mock('../lib/traces-events-queries.js', () => eventsMocks)

vi.mock('../lib/db.js', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      state.fromCalls.push(table)
      if (table === 'traces') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: async () => ({
                  data: { id: 'trace-pg', name: 'pg trace', organization_id: 'org-1' },
                  error: null,
                }),
              }),
            }),
          }),
        }
      }
      // spans
      return {
        select: () => ({
          eq: () => ({
            order: async () => ({ data: [], error: null }),
          }),
        }),
      }
    },
  },
  supabaseClient: {},
}))

async function buildApp() {
  const { tracesRouter } = await import('../api/traces.js')
  const app = new Hono()
  app.route('/api/v1/traces', tracesRouter)
  installOnError(app)
  return app
}

describe('GET /api/v1/traces/:id — events-path NOT_FOUND handling', () => {
  beforeEach(() => {
    state.fromCalls.length = 0
    eventsMocks.getTraceWithSpansFromEvents.mockReset()
  })

  test('nonexistent trace → clean 404, no fake failure log, no Postgres fallback', async () => {
    eventsMocks.getTraceWithSpansFromEvents.mockResolvedValue({ trace: null, spans: [] })
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const app = await buildApp()
      const res = await app.request('/api/v1/traces/no-such-trace')
      expect(res.status).toBe(404)
      const body = (await res.json()) as { error: { code: string } }
      expect(body.error.code).toBe('NOT_FOUND')
      // The legit 404 must not be reported as an events-path failure...
      expect(errSpy).not.toHaveBeenCalled()
      // ...and must not re-query Postgres for a row we know is absent.
      expect(state.fromCalls).toEqual([])
    } finally {
      errSpy.mockRestore()
    }
  })

  test('unexpected events error → logs once and falls back to Postgres', async () => {
    eventsMocks.getTraceWithSpansFromEvents.mockRejectedValue(new Error('CH timeout'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const app = await buildApp()
      const res = await app.request('/api/v1/traces/trace-pg')
      expect(res.status).toBe(200)
      const body = (await res.json()) as { data: { id: string } }
      expect(body.data.id).toBe('trace-pg')
      expect(errSpy).toHaveBeenCalledTimes(1)
      expect(state.fromCalls).toContain('traces')
    } finally {
      errSpy.mockRestore()
    }
  })
})
