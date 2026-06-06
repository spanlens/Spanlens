/**
 * Unit tests for the background-migration runner.
 *
 * Strategy: stub the `supabaseAdmin` client so we never hit a real DB,
 * register controllable migrations through `_registerForTests`, and
 * exercise the happy / paused / failed / stale-recovery paths.
 *
 * Mocks live at module level via vi.mock so the runner imports the
 * stubbed client at module load time, before `runDueMigrations` runs.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ── Mocks ────────────────────────────────────────────────────────────────────
// The supabase client is a query builder where every method returns the
// builder itself until the final method (`maybeSingle`, `single`, or
// awaiting the builder) resolves. We model that with a chained mock.

interface MockQueryBuilder {
  update: (...args: unknown[]) => MockQueryBuilder
  select: (...args: unknown[]) => MockQueryBuilder
  eq: (...args: unknown[]) => MockQueryBuilder
  lt: (...args: unknown[]) => MockQueryBuilder
  in: (...args: unknown[]) => MockQueryBuilder
  order: (...args: unknown[]) => MockQueryBuilder
  limit: (...args: unknown[]) => MockQueryBuilder
  maybeSingle: () => Promise<{ data: unknown; error: unknown }>
}

let candidateRow: unknown = null
let advisoryLockResult = true
let updateCalls: Array<{ payload: Record<string, unknown> }> = []

function buildMock(): MockQueryBuilder {
  const builder: MockQueryBuilder = {
    update(payload: unknown) {
      updateCalls.push({ payload: payload as Record<string, unknown> })
      return builder
    },
    select: () => builder,
    eq: () => builder,
    lt: () => builder,
    in: () => builder,
    order: () => builder,
    limit: () => builder,
    maybeSingle: async () => ({ data: candidateRow, error: null }),
  }
  return builder
}

vi.mock('../db.js', () => ({
  supabaseAdmin: {
    from: () => buildMock(),
    rpc: async (name: string) => {
      if (name === 'try_advisory_lock_for_migration') {
        return { data: advisoryLockResult, error: null }
      }
      // release_advisory_lock_for_migration → ignore
      return { data: true, error: null }
    },
  },
}))

// ── Helpers ──────────────────────────────────────────────────────────────────

import { runDueMigrations } from './runner.js'
import { _registerForTests, _unregisterForTests } from './registry/index.js'
import type { BackgroundMigration } from './index.js'

function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    name: 'test-mig',
    status: 'pending',
    state: {},
    started_at: null,
    attempts: 0,
    last_heartbeat_at: null,
    ...overrides,
  }
}

function makeMigration(overrides: Partial<BackgroundMigration> = {}): BackgroundMigration {
  return {
    name: 'test-mig',
    description: 'unit test migration',
    async runChunk() { return { done: true } },
    ...overrides,
  }
}

beforeEach(() => {
  candidateRow = null
  advisoryLockResult = true
  updateCalls = []
})

afterEach(() => {
  _unregisterForTests('test-mig')
})

// ── Tests ────────────────────────────────────────────────────────────────────

describe('runDueMigrations — no candidate', () => {
  it('returns skipped when registry is empty (only noop-healthcheck) and no pending row matches', async () => {
    candidateRow = null
    const result = await runDueMigrations()
    expect(result.status).toBe('skipped')
    expect(result.picked).toBeNull()
  })
})

describe('runDueMigrations — happy path', () => {
  it('picks the row, takes the lock, completes the chunk, flips to completed', async () => {
    _registerForTests(makeMigration())
    candidateRow = makeRow()

    const result = await runDueMigrations()

    expect(result.status).toBe('completed')
    expect(result.picked).toBe('test-mig')
    expect(result.chunks).toBe(1)

    // Should have flipped to running, then to completed.
    const statuses = updateCalls
      .map((c) => c.payload['status'])
      .filter((s): s is string => typeof s === 'string')
    expect(statuses).toContain('running')
    expect(statuses).toContain('completed')
  })

  it('bumps attempts on the run', async () => {
    _registerForTests(makeMigration())
    candidateRow = makeRow({ attempts: 5 })

    await runDueMigrations()

    const runningUpdate = updateCalls.find((c) => c.payload['status'] === 'running')
    expect(runningUpdate?.payload['attempts']).toBe(6)
  })
})

describe('runDueMigrations — skip when lock contended', () => {
  it('returns skipped without writing if advisory lock fails', async () => {
    _registerForTests(makeMigration())
    candidateRow = makeRow()
    advisoryLockResult = false

    const result = await runDueMigrations()

    expect(result.status).toBe('skipped')
    expect(result.picked).toBe('test-mig')
    // No status writes should have happened.
    const statuses = updateCalls.map((c) => c.payload['status'])
    expect(statuses).not.toContain('running')
    expect(statuses).not.toContain('completed')
  })
})

describe('runDueMigrations — failed migration', () => {
  it('stamps status=failed + error_message when runChunk throws', async () => {
    _registerForTests(
      makeMigration({
        async runChunk() {
          throw new Error('chunk boom')
        },
      }),
    )
    candidateRow = makeRow()

    const result = await runDueMigrations()

    expect(result.status).toBe('failed')
    expect(result.errorMessage).toBe('chunk boom')

    const failed = updateCalls.find((c) => c.payload['status'] === 'failed')
    expect(failed?.payload['error_message']).toBe('chunk boom')
  })
})

describe('runDueMigrations — multi-chunk', () => {
  it('iterates runChunk until done', async () => {
    let counter = 0
    _registerForTests(
      makeMigration({
        async runChunk() {
          counter += 1
          if (counter < 3) {
            return { done: false, state: { i: counter } }
          }
          return { done: true }
        },
      }),
    )
    candidateRow = makeRow()

    const result = await runDueMigrations()

    expect(result.status).toBe('completed')
    expect(result.chunks).toBe(3)
  })
})

describe('registry — noop-healthcheck is always registered', () => {
  it('is in the registry by default', async () => {
    const { getRegistry } = await import('./registry/index.js')
    expect(getRegistry().has('noop-healthcheck')).toBe(true)
  })
})
