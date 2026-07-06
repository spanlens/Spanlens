import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFrom = vi.hoisted(() => vi.fn())
vi.mock('../lib/db.js', () => ({
  supabaseAdmin: { from: mockFrom },
}))

const mockChQuery = vi.hoisted(() => vi.fn())
vi.mock('../lib/clickhouse.js', () => ({
  unscopedClickhouse: () => ({ query: mockChQuery }),
  // Real implementation is trivial — inline it so the module under test
  // still normalizes CH DateTime64 strings to ISO 'Z' form.
  fromClickhouseTimestamp: (s: string | null | undefined) =>
    s ? s.replace(' ', 'T') + 'Z' : null,
}))

const mockSendEmail = vi.hoisted(() => vi.fn())
const mockRenderEmail = vi.hoisted(() =>
  vi.fn(() => ({ subject: 'test subject', html: '<p>test</p>' })),
)
vi.mock('../lib/resend.js', () => ({
  sendEmail: mockSendEmail,
  renderDataSilenceEmail: mockRenderEmail,
}))

const mockGetAdminEmails = vi.hoisted(() => vi.fn())
vi.mock('../lib/admin-emails.js', () => ({
  getAdminEmails: mockGetAdminEmails,
}))

import {
  planSilenceActions,
  runDataSilenceJob,
  DATA_SILENCE_MIN_PRIOR_REQUESTS,
  type OrgTrafficRow,
  type OpenEpisode,
} from '../lib/data-silence.js'

function trafficRow(overrides: Partial<OrgTrafficRow> = {}): OrgTrafficRow {
  return {
    organization_id: 'org-1',
    prior_count: 120,
    recent_count: 0,
    last_request_at: '2026-07-05T08:00:00.000Z',
    ...overrides,
  }
}

function episode(overrides: Partial<OpenEpisode> = {}): OpenEpisode {
  return {
    id: 'ep-1',
    organization_id: 'org-1',
    email_sent: true,
    last_request_at: '2026-07-05T08:00:00.000Z',
    prior_week_requests: 120,
    ...overrides,
  }
}

// ── Pure planning logic ────────────────────────────────────────────

describe('planSilenceActions', () => {
  it('opens an episode for an org with steady prior traffic and zero recent requests', () => {
    const plan = planSilenceActions([trafficRow()], [])
    expect(plan.toOpen).toHaveLength(1)
    expect(plan.toOpen[0]!.organization_id).toBe('org-1')
    expect(plan.toResolve).toEqual([])
    expect(plan.toRetryEmail).toEqual([])
  })

  it('does NOT open for low-traffic orgs (prior below threshold)', () => {
    const plan = planSilenceActions(
      [trafficRow({ prior_count: DATA_SILENCE_MIN_PRIOR_REQUESTS - 1 })],
      [],
    )
    expect(plan.toOpen).toEqual([])
  })

  it('opens at exactly the threshold', () => {
    const plan = planSilenceActions(
      [trafficRow({ prior_count: DATA_SILENCE_MIN_PRIOR_REQUESTS })],
      [],
    )
    expect(plan.toOpen).toHaveLength(1)
  })

  it('does NOT open when the org still has recent traffic', () => {
    const plan = planSilenceActions([trafficRow({ recent_count: 3 })], [])
    expect(plan.toOpen).toEqual([])
  })

  it('does NOT open a second episode while one is already open (dedup)', () => {
    const plan = planSilenceActions([trafficRow()], [episode()])
    expect(plan.toOpen).toEqual([])
  })

  it('resolves an open episode when traffic resumes', () => {
    const plan = planSilenceActions([trafficRow({ recent_count: 12 })], [episode()])
    expect(plan.toResolve).toHaveLength(1)
    expect(plan.toResolve[0]!.id).toBe('ep-1')
    expect(plan.toOpen).toEqual([])
  })

  it('keeps an episode open when the org is absent from traffic (silent > lookback window)', () => {
    const plan = planSilenceActions([], [episode()])
    expect(plan.toResolve).toEqual([])
  })

  it('retries email for a still-silent open episode whose send failed', () => {
    const plan = planSilenceActions([trafficRow()], [episode({ email_sent: false })])
    expect(plan.toRetryEmail).toHaveLength(1)
    expect(plan.toOpen).toEqual([])
  })

  it('retries email for an unsent episode whose org fell out of the lookback window', () => {
    const plan = planSilenceActions([], [episode({ email_sent: false })])
    expect(plan.toRetryEmail).toHaveLength(1)
  })

  it('does NOT retry email once the episode was delivered', () => {
    const plan = planSilenceActions([trafficRow()], [episode({ email_sent: true })])
    expect(plan.toRetryEmail).toEqual([])
  })

  it('does NOT retry email when the org has traffic again (episode resolves instead)', () => {
    const plan = planSilenceActions(
      [trafficRow({ recent_count: 5 })],
      [episode({ email_sent: false })],
    )
    expect(plan.toRetryEmail).toEqual([])
    expect(plan.toResolve).toHaveLength(1)
  })
})

// ── Job integration (mocked I/O) ───────────────────────────────────

interface MockState {
  openEpisodes: OpenEpisode[]
  insertError: null | { message: string; code?: string }
  inserts: Record<string, unknown>[]
  resolvedIdBatches: string[][]
  emailSentIds: string[]
  auditInserts: Record<string, unknown>[]
  orgName: string
}

let state: MockState

function setChTraffic(rows: Array<Record<string, unknown>>): void {
  mockChQuery.mockResolvedValue({ json: () => Promise.resolve(rows) })
}

function setupFrom(): void {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'data_silence_alerts') {
      return {
        select: () => ({
          is: () => Promise.resolve({ data: state.openEpisodes, error: null }),
        }),
        update: (patch: Record<string, unknown>) => ({
          in: (_col: string, ids: string[]) => {
            state.resolvedIdBatches.push(ids)
            return Promise.resolve({ error: null })
          },
          eq: (_col: string, id: string) => {
            if ('email_sent' in patch) state.emailSentIds.push(id)
            return Promise.resolve({ error: null })
          },
        }),
        insert: (row: Record<string, unknown>) => {
          state.inserts.push(row)
          return {
            select: () => ({
              single: () =>
                Promise.resolve(
                  state.insertError
                    ? { data: null, error: state.insertError }
                    : { data: { id: `ep-new-${state.inserts.length}` }, error: null },
                ),
            }),
          }
        },
      }
    }
    if (table === 'organizations') {
      return {
        select: () => ({
          eq: () => ({
            single: () => Promise.resolve({ data: { name: state.orgName }, error: null }),
          }),
        }),
      }
    }
    if (table === 'audit_logs') {
      return {
        insert: (row: Record<string, unknown>) => {
          state.auditInserts.push(row)
          return Promise.resolve({ error: null })
        },
      }
    }
    throw new Error(`unexpected table ${table}`)
  })
}

beforeEach(() => {
  state = {
    openEpisodes: [],
    insertError: null,
    inserts: [],
    resolvedIdBatches: [],
    emailSentIds: [],
    auditInserts: [],
    orgName: 'Acme Inc',
  }
  mockFrom.mockReset()
  mockChQuery.mockReset()
  mockSendEmail.mockReset()
  mockRenderEmail.mockClear()
  mockGetAdminEmails.mockReset()
  setupFrom()
  mockGetAdminEmails.mockResolvedValue(['admin@acme.test'])
  mockSendEmail.mockResolvedValue({ sent: true })
})

describe('runDataSilenceJob — new silence episode', () => {
  it('opens an episode, emails admins, marks email_sent, and writes an audit row', async () => {
    // JSONEachRow returns counts as strings and DateTime64 without Z — the
    // job must survive both (gotchas #18/#19).
    setChTraffic([
      {
        organization_id: 'org-1',
        prior_count: '120',
        recent_count: '0',
        last_request_at: '2026-07-05 08:00:00.000',
      },
    ])

    const result = await runDataSilenceJob()

    expect(result.episodes_opened).toBe(1)
    expect(result.emails_sent).toBe(1)
    expect(result.errors).toEqual([])

    expect(state.inserts).toHaveLength(1)
    expect(state.inserts[0]).toMatchObject({
      organization_id: 'org-1',
      prior_week_requests: 120,
      last_request_at: '2026-07-05T08:00:00.000Z',
    })
    expect(state.emailSentIds).toEqual(['ep-new-1'])
    expect(state.auditInserts).toHaveLength(1)
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'admin@acme.test' }),
    )
    expect(mockRenderEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        orgName: 'Acme Inc',
        priorWeekRequests: 120,
        lastRequestAt: '2026-07-05T08:00:00.000Z',
      }),
    )
  })

  it('skips low-traffic orgs and orgs with recent activity', async () => {
    setChTraffic([
      { organization_id: 'org-low', prior_count: '10', recent_count: '0', last_request_at: null },
      { organization_id: 'org-live', prior_count: '500', recent_count: '42', last_request_at: '2026-07-06 09:00:00.000' },
    ])

    const result = await runDataSilenceJob()
    expect(result.orgs_scanned).toBe(2)
    expect(result.episodes_opened).toBe(0)
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('does not email again while an episode is open (one email per episode)', async () => {
    state.openEpisodes = [episode({ email_sent: true })]
    setChTraffic([
      { organization_id: 'org-1', prior_count: '120', recent_count: '0', last_request_at: '2026-07-05 08:00:00.000' },
    ])

    const result = await runDataSilenceJob()
    expect(result.episodes_opened).toBe(0)
    expect(result.emails_sent).toBe(0)
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('treats a 23505 insert conflict as an already-open episode (no email, no error)', async () => {
    state.insertError = { message: 'duplicate key value', code: '23505' }
    setChTraffic([
      { organization_id: 'org-1', prior_count: '120', recent_count: '0', last_request_at: '2026-07-05 08:00:00.000' },
    ])

    const result = await runDataSilenceJob()
    expect(result.episodes_opened).toBe(0)
    expect(result.errors).toEqual([])
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('records an error and leaves email_sent false when no admin recipients exist', async () => {
    mockGetAdminEmails.mockResolvedValue([])
    setChTraffic([
      { organization_id: 'org-1', prior_count: '120', recent_count: '0', last_request_at: '2026-07-05 08:00:00.000' },
    ])

    const result = await runDataSilenceJob()
    expect(result.episodes_opened).toBe(1)
    expect(result.emails_sent).toBe(0)
    expect(result.errors[0]).toMatch(/no admin recipients/)
    expect(state.emailSentIds).toEqual([])
  })
})

describe('runDataSilenceJob — resolution and retry', () => {
  it('resolves an open episode when traffic resumes', async () => {
    state.openEpisodes = [episode()]
    setChTraffic([
      { organization_id: 'org-1', prior_count: '80', recent_count: '9', last_request_at: '2026-07-06 10:00:00.000' },
    ])

    const result = await runDataSilenceJob()
    expect(result.episodes_resolved).toBe(1)
    expect(state.resolvedIdBatches).toEqual([['ep-1']])
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('retries a failed send on the next run without opening a new episode', async () => {
    state.openEpisodes = [episode({ email_sent: false })]
    // Org fell out of the lookback window entirely — still silent.
    setChTraffic([])

    const result = await runDataSilenceJob()
    expect(result.episodes_opened).toBe(0)
    expect(result.emails_sent).toBe(1)
    expect(state.emailSentIds).toEqual(['ep-1'])
    // Retry uses the stats persisted when the episode was opened.
    expect(mockRenderEmail).toHaveBeenCalledWith(
      expect.objectContaining({ priorWeekRequests: 120 }),
    )
  })

  it('counts a dev-fallback send (RESEND_API_KEY unset) as not sent so it retries later', async () => {
    mockSendEmail.mockResolvedValue({ sent: false })
    setChTraffic([
      { organization_id: 'org-1', prior_count: '120', recent_count: '0', last_request_at: '2026-07-05 08:00:00.000' },
    ])

    const result = await runDataSilenceJob()
    expect(result.episodes_opened).toBe(1)
    expect(result.emails_sent).toBe(0)
    expect(state.emailSentIds).toEqual([])
  })
})

describe('runDataSilenceJob — error handling', () => {
  it('returns an error result when ClickHouse is unreachable', async () => {
    mockChQuery.mockRejectedValue(new Error('CH down'))
    const result = await runDataSilenceJob()
    expect(result.errors).toContain('CH down')
    expect(result.episodes_opened).toBe(0)
  })

  it('continues processing other orgs when one org fails', async () => {
    setChTraffic([
      { organization_id: 'org-a', prior_count: '90', recent_count: '0', last_request_at: '2026-07-05 08:00:00.000' },
      { organization_id: 'org-b', prior_count: '90', recent_count: '0', last_request_at: '2026-07-05 08:00:00.000' },
    ])
    mockGetAdminEmails
      .mockRejectedValueOnce(new Error('auth API down'))
      .mockResolvedValueOnce(['admin@acme.test'])

    const result = await runDataSilenceJob()
    expect(result.episodes_opened).toBe(2)
    expect(result.emails_sent).toBe(1)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatch(/auth API down/)
  })
})
