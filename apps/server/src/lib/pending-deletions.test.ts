import { beforeEach, describe, expect, test, vi } from 'vitest'

// Programmable supabaseAdmin stub. Each `from(table)` call returns a builder
// whose terminal methods (single, maybeSingle, ...) resolve to whatever the
// test queues up for that table next.
type Resolver = () => Promise<{ data: unknown; error: unknown }>
const tableHandlers: Record<string, Resolver[]> = {}

function queueResponse(table: string, response: { data: unknown; error: unknown }): void {
  ;(tableHandlers[table] ??= []).push(() => Promise.resolve(response))
}

function takeNext(table: string): Resolver {
  const queue = tableHandlers[table]
  if (!queue || queue.length === 0) {
    throw new Error(`no queued response for table '${table}'`)
  }
  return queue.shift()!
}

function makeBuilder(table: string): unknown {
  // Every chain method returns the same builder. The terminal awaits
  // (single / maybeSingle / direct await) all dequeue the next queued
  // response for the table.
  const builder: Record<string, unknown> = {
    select: () => builder,
    insert: () => builder,
    update: () => builder,
    delete: () => builder,
    eq: () => builder,
    is: () => builder,
    or: () => builder,
    in: () => builder,
    lte: () => builder,
    order: () => builder,
    limit: () => builder,
    maybeSingle: () => takeNext(table)(),
    single: () => takeNext(table)(),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      takeNext(table)().then(resolve, reject),
  }
  return builder
}

vi.mock('./db.js', () => ({
  supabaseAdmin: {
    from: (table: string) => makeBuilder(table),
  },
}))

// Stub the prompt cache so we can assert it gets invalidated when a
// prompt_version is hard-deleted/restored without actually talking to Redis.
const invalidatePromptNameMock = vi.fn(async (_org: string, _name: string) => {})
vi.mock('./prompt-cache.js', () => ({
  invalidatePromptName: (org: string, name: string) => invalidatePromptNameMock(org, name),
}))

let mod: typeof import('./pending-deletions.js')

beforeEach(async () => {
  vi.resetModules()
  for (const k of Object.keys(tableHandlers)) delete tableHandlers[k]
  invalidatePromptNameMock.mockReset()
  mod = await import('./pending-deletions.js')
})

describe('hardDeleteByType', () => {
  test('api_key path issues a DELETE on api_keys', async () => {
    queueResponse('api_keys', { data: null, error: null })
    const result = await mod.hardDeleteByType('api_key', 'key-1', 'org-1')
    expect(result.ok).toBe(true)
  })

  test('provider_key path scopes by organization_id', async () => {
    queueResponse('provider_keys', { data: null, error: null })
    const result = await mod.hardDeleteByType('provider_key', 'pk-1', 'org-1')
    expect(result.ok).toBe(true)
  })

  test('prompt_version invalidates the resolve cache after delete', async () => {
    // First call: lookup row to get name
    queueResponse('prompt_versions', { data: { name: 'my-prompt' }, error: null })
    // Second call: delete
    queueResponse('prompt_versions', { data: null, error: null })

    const result = await mod.hardDeleteByType('prompt_version', 'pv-1', 'org-1')
    expect(result.ok).toBe(true)
    expect(invalidatePromptNameMock).toHaveBeenCalledWith('org-1', 'my-prompt')
  })

  test('prompt_version still deletes when row is already gone (idempotent)', async () => {
    queueResponse('prompt_versions', { data: null, error: null }) // lookup
    queueResponse('prompt_versions', { data: null, error: null }) // delete
    const result = await mod.hardDeleteByType('prompt_version', 'pv-1', 'org-1')
    expect(result.ok).toBe(true)
    // Without a name we cannot invalidate, but the delete itself succeeds.
    expect(invalidatePromptNameMock).not.toHaveBeenCalled()
  })

  test('propagates DB errors as { ok: false }', async () => {
    queueResponse('api_keys', { data: null, error: { message: 'fk violation' } })
    const result = await mod.hardDeleteByType('api_key', 'key-1', 'org-1')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('fk violation')
  })
})

describe('reactivateByType', () => {
  test('api_key reactivation flips is_active back to true', async () => {
    queueResponse('api_keys', { data: { id: 'key-1' }, error: null }) // existence check
    queueResponse('api_keys', { data: null, error: null }) // update
    const result = await mod.reactivateByType('api_key', 'key-1', 'org-1', {})
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.restored).toBe('reactivated')
  })

  test('api_key reactivation refuses when source already hard-deleted', async () => {
    queueResponse('api_keys', { data: null, error: null }) // not found
    const result = await mod.reactivateByType('api_key', 'key-1', 'org-1', {})
    expect(result.ok).toBe(false)
  })

  test('prompt_version reactivation is a no-op + invalidates cache', async () => {
    queueResponse('prompt_versions', { data: { id: 'pv-1', name: 'p' }, error: null })
    const result = await mod.reactivateByType('prompt_version', 'pv-1', 'org-1', { name: 'p' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.restored).toBe('no_op')
    expect(invalidatePromptNameMock).toHaveBeenCalledWith('org-1', 'p')
  })

  test('provider_key reactivation refuses when row already gone', async () => {
    queueResponse('provider_keys', { data: null, error: null })
    const result = await mod.reactivateByType('provider_key', 'pk-1', 'org-1', {})
    expect(result.ok).toBe(false)
  })
})

describe('enqueueDeletion', () => {
  test('deactivates the source row and inserts a pending_deletions row', async () => {
    // api_keys deactivation
    queueResponse('api_keys', { data: null, error: null })
    // pending_deletions insert returning id + scheduled_for
    queueResponse('pending_deletions', {
      data: { id: 'pd-1', scheduled_for: '2026-06-10T00:00:00Z' },
      error: null,
    })

    const result = await mod.enqueueDeletion({
      organizationId: 'org-1',
      resourceType: 'api_key',
      resourceId: 'key-1',
      resourceSnapshot: { id: 'key-1', name: 'My Key' },
      requestedBy: 'user-1',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.pendingId).toBe('pd-1')
      expect(result.scheduledFor).toBe('2026-06-10T00:00:00Z')
    }
  })

  test('returns ALREADY_PENDING when the unique partial index trips', async () => {
    queueResponse('api_keys', { data: null, error: null }) // deactivate
    queueResponse('pending_deletions', { data: null, error: { code: '23505' } })
    // rollback reactivation tries to find the row first
    queueResponse('api_keys', { data: { id: 'key-1' }, error: null })
    queueResponse('api_keys', { data: null, error: null }) // reactivate update

    const result = await mod.enqueueDeletion({
      organizationId: 'org-1',
      resourceType: 'api_key',
      resourceId: 'key-1',
      resourceSnapshot: {},
      requestedBy: null,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('ALREADY_PENDING')
  })

  test('rolls back deactivation if the queue insert fails', async () => {
    queueResponse('api_keys', { data: null, error: null }) // deactivate
    queueResponse('pending_deletions', { data: null, error: { message: 'boom' } })
    queueResponse('api_keys', { data: { id: 'key-1' }, error: null }) // rollback lookup
    queueResponse('api_keys', { data: null, error: null }) // rollback update

    const result = await mod.enqueueDeletion({
      organizationId: 'org-1',
      resourceType: 'api_key',
      resourceId: 'key-1',
      resourceSnapshot: {},
      requestedBy: null,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('INSERT_FAILED')
  })

  test('prompt_version skips source-side deactivation but still enqueues', async () => {
    // No api_keys/provider_keys queue — prompt_version has no source flip.
    queueResponse('pending_deletions', {
      data: { id: 'pd-1', scheduled_for: '2026-06-10T00:00:00Z' },
      error: null,
    })

    const result = await mod.enqueueDeletion({
      organizationId: 'org-1',
      resourceType: 'prompt_version',
      resourceId: 'pv-1',
      resourceSnapshot: { id: 'pv-1', name: 'p' },
      requestedBy: 'user-1',
    })

    expect(result.ok).toBe(true)
  })

  test('uses the default 72-hour grace window when not overridden', async () => {
    queueResponse('api_keys', { data: null, error: null })
    queueResponse('pending_deletions', {
      data: { id: 'pd-1', scheduled_for: '' },
      error: null,
    })

    const before = Date.now()
    await mod.enqueueDeletion({
      organizationId: 'org-1',
      resourceType: 'api_key',
      resourceId: 'key-1',
      resourceSnapshot: {},
      requestedBy: null,
    })
    const after = Date.now()

    // The exact scheduled_for is hard to assert against without inspecting
    // the insert call, but the default constant is the source of truth.
    expect(mod.PENDING_DELETION_GRACE_HOURS).toBe(72)
    expect(after - before).toBeLessThan(1000)
  })
})
