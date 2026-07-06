import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFrom = vi.hoisted(() => vi.fn())
vi.mock('../lib/db.js', () => ({
  supabaseAdmin: { from: mockFrom },
}))

const mockChQuery = vi.hoisted(() => vi.fn())
vi.mock('../lib/clickhouse.js', () => ({
  unscopedClickhouse: () => ({ query: mockChQuery }),
  // Real implementation is trivial — inline it so the module under test
  // still produces ClickHouse-shaped timestamps (gotcha #18).
  toClickhouseTimestamp: (d: Date) => d.toISOString().replace('T', ' ').replace('Z', ''),
}))

const mockSendEmail = vi.hoisted(() => vi.fn())
const mockRenderEmail = vi.hoisted(() =>
  vi.fn(() => ({ subject: 'test subject', html: '<p>test</p>' })),
)
vi.mock('../lib/resend.js', () => ({
  sendEmail: mockSendEmail,
  renderWeeklyDigestEmail: mockRenderEmail,
}))

const mockGetRecipients = vi.hoisted(() => vi.fn())
vi.mock('../lib/digest-recipients.js', () => ({
  getWeeklyDigestRecipients: mockGetRecipients,
}))

const mockRecommend = vi.hoisted(() => vi.fn())
vi.mock('../lib/model-recommend.js', () => ({
  recommendModelSwaps: mockRecommend,
}))

import {
  computeDigestWindow,
  isoWeekStartUtc,
  formatPeriodLabel,
  computeCostChangePct,
  pickTopRecommendation,
  topModelsByOrg,
  runWeeklyDigestJob,
  DIGEST_TOP_MODELS_LIMIT,
} from '../lib/weekly-digest.js'
import type { ModelRecommendation } from '../lib/model-recommend.js'

// 2026-07-06 is a Monday.
const MONDAY = new Date('2026-07-06T09:00:00.000Z')

function rec(overrides: Partial<ModelRecommendation> = {}): ModelRecommendation {
  return {
    currentProvider: 'openai',
    currentModel: 'gpt-4o',
    sampleCount: 100,
    avgPromptTokens: 500,
    avgCompletionTokens: 200,
    totalCostUsdLastNDays: 40,
    suggestedProvider: 'openai',
    suggestedModel: 'gpt-4o-mini',
    estimatedMonthlySavingsUsd: 120,
    reason: 'cheaper for small prompts',
    maxPromptTokens: 4000,
    maxCompletionTokens: 1000,
    priorWindowCostUsd: null,
    achieved: false,
    actualMonthlySavingsUsd: null,
    ...overrides,
  }
}

// ── Pure helpers ───────────────────────────────────────────────────

describe('computeDigestWindow', () => {
  it('covers the last 7 full UTC days ending at today 00:00 UTC', () => {
    const w = computeDigestWindow(MONDAY)
    expect(w.weekEnd.toISOString()).toBe('2026-07-06T00:00:00.000Z')
    expect(w.weekStart.toISOString()).toBe('2026-06-29T00:00:00.000Z')
    expect(w.priorStart.toISOString()).toBe('2026-06-22T00:00:00.000Z')
  })
})

describe('isoWeekStartUtc', () => {
  it('returns the same day at midnight for a Monday', () => {
    expect(isoWeekStartUtc(MONDAY).toISOString()).toBe('2026-07-06T00:00:00.000Z')
  })

  it('returns the previous Monday for a Sunday', () => {
    const sunday = new Date('2026-07-05T23:59:00.000Z')
    expect(isoWeekStartUtc(sunday).toISOString()).toBe('2026-06-29T00:00:00.000Z')
  })
})

describe('formatPeriodLabel', () => {
  it('labels the window with the first and last INCLUDED day', () => {
    expect(formatPeriodLabel(computeDigestWindow(MONDAY))).toBe('Jun 29 to Jul 5')
  })
})

describe('computeCostChangePct', () => {
  it('computes the week-over-week percentage', () => {
    expect(computeCostChangePct(110, 100, 500)).toBeCloseTo(10)
    expect(computeCostChangePct(50, 100, 500)).toBeCloseTo(-50)
  })

  it('returns null when the prior week had no requests', () => {
    expect(computeCostChangePct(100, 0, 0)).toBeNull()
  })

  it('returns null when the prior week had requests but zero recorded cost', () => {
    expect(computeCostChangePct(100, 0, 42)).toBeNull()
  })
})

describe('pickTopRecommendation', () => {
  it('returns null for an empty list', () => {
    expect(pickTopRecommendation([])).toBeNull()
  })

  it('picks the highest projected monthly savings', () => {
    const best = pickTopRecommendation([
      rec({ estimatedMonthlySavingsUsd: 10, currentModel: 'a' }),
      rec({ estimatedMonthlySavingsUsd: 99, currentModel: 'b' }),
      rec({ estimatedMonthlySavingsUsd: 40, currentModel: 'c' }),
    ])
    expect(best?.currentModel).toBe('b')
  })
})

describe('topModelsByOrg', () => {
  it('groups per org, sorts by cost desc, and keeps the top 3', () => {
    const rows = [
      { organization_id: 'org-1', provider: 'openai', model: 'm1', cost_usd: 1, request_count: 10 },
      { organization_id: 'org-1', provider: 'openai', model: 'm2', cost_usd: 9, request_count: 5 },
      { organization_id: 'org-1', provider: 'anthropic', model: 'm3', cost_usd: 4, request_count: 8 },
      { organization_id: 'org-1', provider: 'gemini', model: 'm4', cost_usd: 2, request_count: 2 },
      { organization_id: 'org-2', provider: 'openai', model: 'm5', cost_usd: 3, request_count: 1 },
    ]
    const grouped = topModelsByOrg(rows)
    expect(grouped.get('org-1')).toHaveLength(DIGEST_TOP_MODELS_LIMIT)
    expect(grouped.get('org-1')!.map((m) => m.model)).toEqual(['m2', 'm3', 'm4'])
    expect(grouped.get('org-2')!.map((m) => m.model)).toEqual(['m5'])
  })
})

// ── Job integration (mocked I/O) ───────────────────────────────────

interface MockState {
  claimError: null | { code?: string; message: string }
  claimInserts: Record<string, unknown>[]
  statsRows: Array<Record<string, unknown>>
  modelRows: Array<Record<string, unknown>>
  orgNames: Array<{ id: string; name: string | null }>
  anomalyCount: number | null
  anomalyError: null | { message: string }
  auditInserts: Record<string, unknown>[]
}

let state: MockState

function setupMocks(): void {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'weekly_digest_runs') {
      return {
        insert: (row: Record<string, unknown>) => {
          state.claimInserts.push(row)
          return Promise.resolve({ error: state.claimError })
        },
      }
    }
    if (table === 'organizations') {
      return {
        select: () => ({
          in: () => Promise.resolve({ data: state.orgNames, error: null }),
        }),
      }
    }
    if (table === 'anomaly_events') {
      return {
        select: () => ({
          eq: () => ({
            gte: () => ({
              lt: () =>
                Promise.resolve(
                  state.anomalyError
                    ? { count: null, error: state.anomalyError }
                    : { count: state.anomalyCount, error: null },
                ),
            }),
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

  mockChQuery.mockImplementation((args: { query: string }) => {
    const isTopModels = args.query.includes('GROUP BY organization_id, provider, model')
    return Promise.resolve({
      json: () => Promise.resolve(isTopModels ? state.modelRows : state.statsRows),
    })
  })
}

beforeEach(() => {
  state = {
    claimError: null,
    claimInserts: [],
    // JSONEachRow returns counts and Decimal sums as strings — the job must
    // coerce every numeric at the boundary (gotcha #19).
    statsRows: [
      {
        organization_id: 'org-1',
        request_count: '1234',
        total_cost_usd: '12.5',
        error_count: '12',
        prior_request_count: '900',
        prior_cost_usd: '10.0',
      },
    ],
    modelRows: [
      { organization_id: 'org-1', provider: 'openai', model: 'gpt-4o', cost_usd: '9.5', request_count: '400' },
      { organization_id: 'org-1', provider: 'openai', model: 'gpt-4o-mini', cost_usd: '3.0', request_count: '834' },
    ],
    orgNames: [{ id: 'org-1', name: 'Acme Inc' }],
    anomalyCount: 2,
    anomalyError: null,
    auditInserts: [],
  }
  mockFrom.mockReset()
  mockChQuery.mockReset()
  mockSendEmail.mockReset()
  mockRenderEmail.mockClear()
  mockGetRecipients.mockReset()
  mockRecommend.mockReset()
  setupMocks()
  mockGetRecipients.mockResolvedValue(['admin@acme.test', 'other@acme.test'])
  mockSendEmail.mockResolvedValue({ sent: true })
  mockRecommend.mockResolvedValue([rec()])
})

describe('runWeeklyDigestJob — happy path', () => {
  it('sends one digest per active org with coerced numbers and writes an audit row', async () => {
    const result = await runWeeklyDigestJob(MONDAY)

    expect(result.skipped).toBe(false)
    expect(result.completed).toBe(true)
    expect(result.orgs_scanned).toBe(1)
    expect(result.digests_sent).toBe(1)
    expect(result.errors).toEqual([])

    // Both recipients get the same rendered email.
    expect(mockSendEmail).toHaveBeenCalledTimes(2)
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'admin@acme.test', subject: 'test subject' }),
    )

    expect(mockRenderEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        orgName: 'Acme Inc',
        periodLabel: 'Jun 29 to Jul 5',
        requestCount: 1234,
        totalCostUsd: 12.5,
        costChangePct: expect.closeTo(25, 5),
        errorCount: 12,
        errorRatePct: expect.closeTo((12 / 1234) * 100, 5),
        anomalyCount: 2,
        recommendation: expect.objectContaining({
          currentModel: 'gpt-4o',
          suggestedModel: 'gpt-4o-mini',
          estimatedMonthlySavingsUsd: 120,
        }),
      }),
    )

    // Top models are cost-sorted numbers, not JSONEachRow strings.
    const renderCalls = mockRenderEmail.mock.calls as unknown as Array<
      [{ topModels: Array<{ model: string; costUsd: number }>; dashboardUrl: string }]
    >
    const call = renderCalls[0]![0]
    expect(call.topModels.map((m) => m.model)).toEqual(['gpt-4o', 'gpt-4o-mini'])
    expect(call.topModels[0]!.costUsd).toBe(9.5)
    expect(call.dashboardUrl).toMatch(/\/dashboard$/)

    expect(state.auditInserts).toHaveLength(1)
    expect(state.auditInserts[0]).toMatchObject({
      organization_id: 'org-1',
      action: 'retention.weekly_digest_sent',
    })
  })

  it('falls back to a generic org name when the lookup has no row', async () => {
    state.orgNames = []
    await runWeeklyDigestJob(MONDAY)
    expect(mockRenderEmail).toHaveBeenCalledWith(
      expect.objectContaining({ orgName: 'your workspace' }),
    )
  })
})

describe('runWeeklyDigestJob — skip logic', () => {
  it('claims the ISO week atomically before any email goes out', async () => {
    const result = await runWeeklyDigestJob(MONDAY)
    expect(result.skipped).toBe(false)
    expect(state.claimInserts).toHaveLength(1)
    // MONDAY fixture is inside the ISO week starting that same Monday.
    expect(state.claimInserts[0]).toMatchObject({
      week_start: MONDAY.toISOString().slice(0, 10),
    })
  })

  it('skips entirely when another runner already claimed this ISO week', async () => {
    state.claimError = { code: '23505', message: 'duplicate key value' }

    const result = await runWeeklyDigestJob(MONDAY)
    expect(result.skipped).toBe(true)
    expect(result.completed).toBe(true)
    expect(mockChQuery).not.toHaveBeenCalled()
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('still runs (best-effort) when the claim insert fails transiently', async () => {
    state.claimError = { message: 'pg down' }

    const result = await runWeeklyDigestJob(MONDAY)
    expect(result.skipped).toBe(false)
    expect(result.digests_sent).toBe(1)
    expect(result.errors[0]).toMatch(/claim failed/)
  })

  it('skips orgs with zero requests in the window (no email at all)', async () => {
    state.statsRows = [
      {
        organization_id: 'org-idle',
        request_count: '0',
        total_cost_usd: '0',
        error_count: '0',
        prior_request_count: '500',
        prior_cost_usd: '5.0',
      },
    ]

    const result = await runWeeklyDigestJob(MONDAY)
    expect(result.completed).toBe(true)
    expect(result.orgs_scanned).toBe(0)
    expect(result.digests_sent).toBe(0)
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('counts orgs whose admins all opted out without treating them as errors', async () => {
    mockGetRecipients.mockResolvedValue([])

    const result = await runWeeklyDigestJob(MONDAY)
    expect(result.orgs_no_recipients).toBe(1)
    expect(result.digests_sent).toBe(0)
    expect(result.errors).toEqual([])
    expect(mockSendEmail).not.toHaveBeenCalled()
  })
})

describe('runWeeklyDigestJob — degraded enrichments', () => {
  it('still sends when the recommendation engine throws (recommendation null)', async () => {
    mockRecommend.mockRejectedValue(new Error('CH busy'))

    const result = await runWeeklyDigestJob(MONDAY)
    expect(result.digests_sent).toBe(1)
    expect(mockRenderEmail).toHaveBeenCalledWith(
      expect.objectContaining({ recommendation: null }),
    )
  })

  it('passes recommendation null when no swaps qualify', async () => {
    mockRecommend.mockResolvedValue([])
    await runWeeklyDigestJob(MONDAY)
    expect(mockRenderEmail).toHaveBeenCalledWith(
      expect.objectContaining({ recommendation: null }),
    )
  })

  it('passes anomalyCount null when the anomaly_events lookup fails', async () => {
    state.anomalyError = { message: 'pg down' }

    const result = await runWeeklyDigestJob(MONDAY)
    expect(result.digests_sent).toBe(1)
    expect(mockRenderEmail).toHaveBeenCalledWith(
      expect.objectContaining({ anomalyCount: null }),
    )
  })

  it('counts a dev-fallback send (RESEND_API_KEY unset) as not sent', async () => {
    mockSendEmail.mockResolvedValue({ sent: false })

    const result = await runWeeklyDigestJob(MONDAY)
    expect(result.digests_sent).toBe(0)
    expect(state.auditInserts).toEqual([])
  })
})

describe('runWeeklyDigestJob — error handling', () => {
  it('returns completed=false when ClickHouse is unreachable', async () => {
    mockChQuery.mockRejectedValue(new Error('CH down'))

    const result = await runWeeklyDigestJob(MONDAY)
    expect(result.completed).toBe(false)
    expect(result.errors).toContain('CH down')
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('continues processing other orgs when one org fails', async () => {
    state.statsRows = [
      { organization_id: 'org-a', request_count: '10', total_cost_usd: '1', error_count: '0', prior_request_count: '0', prior_cost_usd: '0' },
      { organization_id: 'org-b', request_count: '20', total_cost_usd: '2', error_count: '0', prior_request_count: '0', prior_cost_usd: '0' },
    ]
    state.orgNames = [
      { id: 'org-a', name: 'A' },
      { id: 'org-b', name: 'B' },
    ]
    mockGetRecipients
      .mockRejectedValueOnce(new Error('auth API down'))
      .mockResolvedValueOnce(['admin@b.test'])

    const result = await runWeeklyDigestJob(MONDAY)
    expect(result.completed).toBe(true)
    expect(result.digests_sent).toBe(1)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatch(/org org-a: auth API down/)
  })
})
