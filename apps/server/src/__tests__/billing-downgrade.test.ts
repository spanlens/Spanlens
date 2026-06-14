import { beforeEach, describe, expect, test, vi } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// Tests for P2.7 auto-downgrade orchestration. The cron flips paying orgs
// to Free after 7 days of payment failure and emails warnings at D-3 / D-1.
// A regression here either downgrades too aggressively (revenue + trust
// damage) or never (we eat free LLM traffic indefinitely). Both bad.
// ─────────────────────────────────────────────────────────────────────────────

const supabaseFromMock = vi.fn()
const getUserByIdMock = vi.fn()
const sendEmailMock = vi.fn()
const renderPastDueEmailMock = vi.fn()

vi.mock('../lib/db.js', () => ({
  supabaseAdmin: {
    from: (...args: unknown[]) => supabaseFromMock(...args),
    auth: { admin: { getUserById: (...args: unknown[]) => getUserByIdMock(...args) } },
  },
}))

vi.mock('../lib/resend.js', () => ({
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
  renderPastDueEmail: (...args: unknown[]) => renderPastDueEmailMock(...args),
}))

let runDowngradeCheck: typeof import('../lib/billing-downgrade.js').runDowngradeCheck

beforeEach(async () => {
  vi.resetModules()
  supabaseFromMock.mockReset()
  getUserByIdMock.mockReset()
  sendEmailMock.mockReset().mockResolvedValue({ sent: true })
  renderPastDueEmailMock
    .mockReset()
    .mockReturnValue({ subject: 'mock', html: '<p>mock</p>' })
  ;({ runDowngradeCheck } = await import('../lib/billing-downgrade.js'))
})

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
}

/**
 * Builds the chained Supabase mock used in every test. We compose smaller
 * sub-mocks per table so each test can express exactly the subscriptions
 * shape it wants.
 */
function setupSupabaseMocks(opts: {
  pastDueRows: Array<{ id: string; organization_id: string; past_due_since: string; paddle_subscription_id?: string | null }>
  dedupeInsertResult?: { error: { code?: string; message: string } | null }
  ownerEmail?: string | null
  orgName?: string
}) {
  // Capture every UPDATE/INSERT for assertions
  const mutations: Array<{ table: string; op: string; values: unknown }> = []

  supabaseFromMock.mockImplementation((table: string) => {
    if (table === 'subscriptions') {
      return {
        select: vi.fn().mockReturnValue({
          not: vi.fn().mockResolvedValue({ data: opts.pastDueRows, error: null }),
        }),
        update: (values: unknown) => {
          mutations.push({ table, op: 'update', values })
          return { eq: vi.fn().mockResolvedValue({ data: null, error: null }) }
        },
      }
    }

    if (table === 'billing_downgrade_notifications') {
      return {
        insert: (values: unknown) => {
          mutations.push({ table, op: 'insert', values })
          // Default to success unless test overrode dedupeInsertResult
          return Promise.resolve(
            opts.dedupeInsertResult ?? { error: null },
          )
        },
      }
    }

    if (table === 'organizations') {
      return {
        update: (values: unknown) => {
          mutations.push({ table, op: 'update', values })
          return { eq: vi.fn().mockResolvedValue({ data: null, error: null }) }
        },
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              // fetchOwner now reads owner_id off organizations (the org_role
              // enum has no 'owner' value). owner_id is null when the test
              // wants the no-owner path.
              data: {
                name: opts.orgName ?? 'Acme',
                owner_id: opts.ownerEmail ? 'usr_owner' : null,
              },
              error: null,
            }),
          }),
        }),
      }
    }

    if (table === 'audit_logs') {
      return {
        insert: (values: unknown) => {
          mutations.push({ table, op: 'insert', values })
          return Promise.resolve({ data: null, error: null })
        },
      }
    }

    throw new Error(`unmocked Supabase table: ${table}`)
  })

  getUserByIdMock.mockResolvedValue({
    data: { user: opts.ownerEmail ? { email: opts.ownerEmail } : null },
  })

  return { mutations }
}

describe('runDowngradeCheck — staging', () => {
  test('no past_due rows → all counters zero, no email', async () => {
    setupSupabaseMocks({ pastDueRows: [] })

    const result = await runDowngradeCheck()
    expect(result).toEqual({
      scanned: 0,
      warningsD3: 0,
      warningsD1: 0,
      downgraded: 0,
      emailsSkipped: 0,
      errors: [],
    })
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  test('past_due_since < 4 days → no email sent yet', async () => {
    setupSupabaseMocks({
      pastDueRows: [
        { id: 's_fresh', organization_id: 'org_1', past_due_since: daysAgo(2) },
      ],
      ownerEmail: 'owner@example.com',
    })

    const result = await runDowngradeCheck()
    expect(result.scanned).toBe(1)
    expect(result.warningsD3).toBe(0)
    expect(result.warningsD1).toBe(0)
    expect(result.downgraded).toBe(0)
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  test('past_due_since exactly 4 days → D-3 warning sent', async () => {
    setupSupabaseMocks({
      pastDueRows: [
        { id: 's_d3', organization_id: 'org_1', past_due_since: daysAgo(4) },
      ],
      ownerEmail: 'owner@example.com',
    })

    const result = await runDowngradeCheck()
    expect(result.warningsD3).toBe(1)
    expect(sendEmailMock).toHaveBeenCalledOnce()
    expect(renderPastDueEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'warning-d3' }),
    )
  })

  test('past_due_since exactly 6 days → D-1 warning sent', async () => {
    setupSupabaseMocks({
      pastDueRows: [
        { id: 's_d1', organization_id: 'org_1', past_due_since: daysAgo(6) },
      ],
      ownerEmail: 'owner@example.com',
    })

    const result = await runDowngradeCheck()
    expect(result.warningsD1).toBe(1)
    expect(renderPastDueEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'warning-d1' }),
    )
  })

  test('past_due_since >= 7 days → org downgraded + plan flipped + audit log', async () => {
    const { mutations } = setupSupabaseMocks({
      pastDueRows: [
        {
          id: 's_old',
          organization_id: 'org_1',
          past_due_since: daysAgo(8),
          paddle_subscription_id: 'sub_paddle_1',
        },
      ],
      ownerEmail: 'owner@example.com',
    })

    const result = await runDowngradeCheck()
    expect(result.downgraded).toBe(1)

    // Plan flipped
    const orgUpdate = mutations.find((m) => m.table === 'organizations' && m.op === 'update')
    expect(orgUpdate?.values).toEqual({ plan: 'free' })

    // past_due_since cleared so a re-upgrade starts fresh
    const subUpdate = mutations.find((m) => m.table === 'subscriptions' && m.op === 'update')
    expect(subUpdate?.values).toEqual({ past_due_since: null })

    // Audit log written
    const audit = mutations.find((m) => m.table === 'audit_logs' && m.op === 'insert')
    expect(audit?.values).toMatchObject({
      action: 'billing.plan.auto_downgrade',
      organization_id: 'org_1',
      metadata: expect.objectContaining({
        reason: 'past_due_7_days',
        paddle_subscription_id: 'sub_paddle_1',
      }),
    })

    // Downgrade email sent
    expect(renderPastDueEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'downgraded' }),
    )
  })
})

describe('runDowngradeCheck — idempotency', () => {
  test('dedupe table returns 23505 unique_violation → no email, emailsSkipped++', async () => {
    setupSupabaseMocks({
      pastDueRows: [
        { id: 's_d3', organization_id: 'org_1', past_due_since: daysAgo(4) },
      ],
      ownerEmail: 'owner@example.com',
      dedupeInsertResult: {
        error: { code: '23505', message: 'duplicate key' },
      },
    })

    const result = await runDowngradeCheck()
    expect(result.warningsD3).toBe(0)
    expect(result.emailsSkipped).toBe(1)
    expect(sendEmailMock).not.toHaveBeenCalled()
  })
})

describe('runDowngradeCheck — failure modes', () => {
  test('Supabase SELECT failure → error captured, no rows processed', async () => {
    supabaseFromMock.mockImplementation((table: string) => {
      if (table === 'subscriptions') {
        return {
          select: vi.fn().mockReturnValue({
            not: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'connection refused' },
            }),
          }),
        }
      }
      throw new Error(`unmocked: ${table}`)
    })

    const result = await runDowngradeCheck()
    expect(result.errors[0]).toMatch(/select past_due rows failed.*connection refused/)
  })

  test('per-row exception is collected and does not abort other rows', async () => {
    // Two rows: first one due for D-3, second for downgrade. We make the
    // first throw during email rendering. The second still has to process.
    let renderCalls = 0
    renderPastDueEmailMock.mockImplementation(() => {
      renderCalls += 1
      if (renderCalls === 1) throw new Error('template render failed')
      return { subject: 'ok', html: '<p>ok</p>' }
    })

    setupSupabaseMocks({
      pastDueRows: [
        { id: 's_d3', organization_id: 'org_1', past_due_since: daysAgo(4) },
        { id: 's_old', organization_id: 'org_2', past_due_since: daysAgo(9) },
      ],
      ownerEmail: 'owner@example.com',
    })

    const result = await runDowngradeCheck()
    expect(result.scanned).toBe(2)
    expect(result.errors.length).toBe(1)
    expect(result.errors[0]).toContain('org_1')
    expect(result.errors[0]).toContain('template render failed')
    // The second row still went through
    expect(result.downgraded).toBe(1)
  })
})
