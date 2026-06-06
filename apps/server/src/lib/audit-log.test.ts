import { beforeEach, describe, expect, test, vi } from 'vitest'

// Programmable mock for supabaseAdmin.from('audit_logs').insert(...).
const insertMock = vi.fn()
vi.mock('./db.js', () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      insert: (values: Record<string, unknown>) => insertMock(table, values),
    }),
  },
}))

let mod: typeof import('./audit-log.js')

beforeEach(async () => {
  vi.resetModules()
  insertMock.mockReset()
  mod = await import('./audit-log.js')
})

// Minimal Hono-like context the helper consumes. We don't pull in Hono itself
// because the surface is two methods (`get`, `req.header`) and a real Hono
// app inside unit tests is overkill.
interface FakeCtx {
  get(key: string): string | undefined
  req: { header(name: string): string | undefined }
}

function makeCtx(opts: {
  orgId?: string
  userId?: string
  organizationId?: string
  headers?: Record<string, string>
}): FakeCtx {
  const get = (key: string) => {
    if (key === 'orgId') return opts.orgId
    if (key === 'organizationId') return opts.organizationId
    if (key === 'userId') return opts.userId
    return undefined
  }
  const header = (name: string) => opts.headers?.[name.toLowerCase()]
  return { get, req: { header } }
}

describe('auditContextFromHono', () => {
  test('pulls orgId + userId from authJwt-style context', () => {
    const ctx = makeCtx({ orgId: 'org-1', userId: 'user-1' })
    expect(mod.auditContextFromHono(ctx as never)).toEqual({
      organizationId: 'org-1',
      userId: 'user-1',
      ipAddress: null,
    })
  })

  test('falls back to organizationId when orgId is unset', () => {
    const ctx = makeCtx({ organizationId: 'org-2' })
    expect(mod.auditContextFromHono(ctx as never).organizationId).toBe('org-2')
  })

  test('takes only the first IP from x-forwarded-for (client hop)', () => {
    const ctx = makeCtx({
      orgId: 'org-1',
      headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.1, 10.0.0.2' },
    })
    expect(mod.auditContextFromHono(ctx as never).ipAddress).toBe('203.0.113.5')
  })

  test('falls back to x-real-ip when x-forwarded-for is missing', () => {
    const ctx = makeCtx({
      orgId: 'org-1',
      headers: { 'x-real-ip': '198.51.100.10' },
    })
    expect(mod.auditContextFromHono(ctx as never).ipAddress).toBe('198.51.100.10')
  })

  test('falls back to cf-connecting-ip', () => {
    const ctx = makeCtx({
      orgId: 'org-1',
      headers: { 'cf-connecting-ip': '198.51.100.99' },
    })
    expect(mod.auditContextFromHono(ctx as never).ipAddress).toBe('198.51.100.99')
  })

  test('returns null ip when no headers present', () => {
    const ctx = makeCtx({ orgId: 'org-1' })
    expect(mod.auditContextFromHono(ctx as never).ipAddress).toBeNull()
  })
})

describe('recordAuditLog', () => {
  test('inserts a row with normalized payload', async () => {
    insertMock.mockResolvedValueOnce({ error: null })

    const ok = await mod.recordAuditLog(
      { organizationId: 'org-1', userId: 'user-1', ipAddress: '203.0.113.5' },
      {
        action: 'api_key.create',
        resourceType: 'api_keys',
        resourceId: 'key-1',
        metadata: { scope: 'full' },
      },
    )

    expect(ok).toBe(true)
    expect(insertMock).toHaveBeenCalledTimes(1)
    const [table, values] = insertMock.mock.calls[0] ?? []
    expect(table).toBe('audit_logs')
    expect(values).toMatchObject({
      organization_id: 'org-1',
      user_id: 'user-1',
      action: 'api_key.create',
      resource_type: 'api_keys',
      resource_id: 'key-1',
      metadata: { scope: 'full' },
      ip_address: '203.0.113.5',
    })
  })

  test('drops the row (returns false) when organization_id is missing', async () => {
    const ok = await mod.recordAuditLog(
      { organizationId: null, userId: 'user-1' },
      { action: 'noop.test', resourceType: 'noop' },
    )
    expect(ok).toBe(false)
    expect(insertMock).not.toHaveBeenCalled()
  })

  test('returns false on DB error but never throws', async () => {
    insertMock.mockResolvedValueOnce({ error: { message: 'boom' } })

    const ok = await mod.recordAuditLog(
      { organizationId: 'org-1', userId: null },
      { action: 'x.y', resourceType: 'x' },
    )
    expect(ok).toBe(false)
  })

  test('defaults metadata to {} and resource_id to null when omitted', async () => {
    insertMock.mockResolvedValueOnce({ error: null })

    await mod.recordAuditLog(
      { organizationId: 'org-1', userId: 'u1' },
      { action: 'workspace.update', resourceType: 'organizations' },
    )

    const values = insertMock.mock.calls[0]?.[1] as Record<string, unknown>
    expect(values.metadata).toEqual({})
    expect(values.resource_id).toBeNull()
  })
})

describe('recordAuditEvent (Hono wrapper)', () => {
  test('extracts context then delegates to recordAuditLog', async () => {
    insertMock.mockResolvedValueOnce({ error: null })

    const ctx = makeCtx({
      orgId: 'org-9',
      userId: 'user-9',
      headers: { 'x-forwarded-for': '198.51.100.1' },
    })

    const ok = await mod.recordAuditEvent(ctx as never, {
      action: 'provider_key.add',
      resourceType: 'provider_keys',
      resourceId: 'pk-1',
      metadata: { provider: 'openai' },
    })

    expect(ok).toBe(true)
    const values = insertMock.mock.calls[0]?.[1] as Record<string, unknown>
    expect(values.organization_id).toBe('org-9')
    expect(values.user_id).toBe('user-9')
    expect(values.ip_address).toBe('198.51.100.1')
    expect(values.action).toBe('provider_key.add')
  })
})
