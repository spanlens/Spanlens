import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFrom = vi.hoisted(() => vi.fn())
vi.mock('../lib/db.js', () => ({
  supabaseAdmin: { from: mockFrom },
}))

const mockDetectAnomalies = vi.hoisted(() => vi.fn())
vi.mock('../lib/anomaly.js', () => ({
  detectAnomalies: mockDetectAnomalies,
  ANOMALY_DEFAULTS: {
    OBSERVATION_HOURS: 1,
    REFERENCE_HOURS: 168,
    SIGMA_THRESHOLD: 3,
    MIN_SAMPLES: 30,
    HIGH_SEVERITY_SIGMA: 5,
  },
}))

const mockDeliverToChannel = vi.hoisted(() => vi.fn())
vi.mock('../lib/notifiers.js', () => ({
  deliverToChannel: mockDeliverToChannel,
}))

import { snapshotAnomaliesForAllOrgs } from '../lib/anomaly-snapshot.js'
import type { AnomalyBucket } from '../lib/anomaly.js'

// Chainable query builder — terminal methods resolve immediately.
function makeChain(result: unknown) {
  const self: Record<string, (...args: unknown[]) => unknown> = {}
  for (const m of ['select', 'gte', 'eq', 'order', 'lte', 'is_active']) {
    self[m] = () => self
  }
  self['single'] = () => Promise.resolve(result)
  self['returns'] = () => Promise.resolve(result)
  self['upsert'] = () => Promise.resolve(result)
  return self
}

function makeAnomaly(overrides: Partial<AnomalyBucket> = {}): AnomalyBucket {
  return {
    provider: 'openai',
    model: 'gpt-4o-mini',
    kind: 'latency',
    currentValue: 800,
    baselineMean: 200,
    baselineStdDev: 50,
    deviations: 3.5,
    sampleCount: 40,
    referenceCount: 200,
    ...overrides,
  }
}

function setupFrom({
  orgIds = ['org-1'],
  upsertError = null as null | { message: string },
  channels = [] as { kind: string; target: string }[],
  orgName = 'Test Org',
} = {}) {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'requests') {
      return makeChain({ data: orgIds.map((id) => ({ organization_id: id })), error: null })
    }
    if (table === 'anomaly_events') {
      return { upsert: () => Promise.resolve({ error: upsertError }) }
    }
    if (table === 'notification_channels') {
      return makeChain({ data: channels, error: null })
    }
    if (table === 'organizations') {
      return makeChain({ data: { name: orgName }, error: null })
    }
    return makeChain({ data: null, error: null })
  })
}

beforeEach(() => {
  mockFrom.mockReset()
  mockDetectAnomalies.mockReset()
  mockDeliverToChannel.mockReset()
})

describe('snapshotAnomaliesForAllOrgs — no traffic', () => {
  it('returns [] when no orgs have recent traffic', async () => {
    setupFrom({ orgIds: [] })
    const results = await snapshotAnomaliesForAllOrgs()
    expect(results).toEqual([])
    expect(mockDetectAnomalies).not.toHaveBeenCalled()
  })
})

describe('snapshotAnomaliesForAllOrgs — no anomalies', () => {
  it('returns result with detected=0 when detection finds nothing', async () => {
    setupFrom()
    mockDetectAnomalies.mockResolvedValue([])
    const results = await snapshotAnomaliesForAllOrgs()
    expect(results).toHaveLength(1)
    expect(results[0]).toEqual({ orgId: 'org-1', detected: 0, errors: [] })
    expect(mockDeliverToChannel).not.toHaveBeenCalled()
  })
})

describe('snapshotAnomaliesForAllOrgs — anomalies detected', () => {
  it('persists anomalies and returns correct count', async () => {
    setupFrom({ channels: [] })
    const anomaly = makeAnomaly({ deviations: 3.5 })
    mockDetectAnomalies.mockResolvedValue([anomaly])

    const results = await snapshotAnomaliesForAllOrgs()
    expect(results[0]!.detected).toBe(1)
    expect(results[0]!.errors).toEqual([])
    expect(mockFrom).toHaveBeenCalledWith('anomaly_events')
  })

  it('does NOT notify for medium-severity anomalies (< HIGH_SEVERITY_SIGMA)', async () => {
    setupFrom({ channels: [{ kind: 'email', target: 'alert@test.com' }] })
    mockDetectAnomalies.mockResolvedValue([makeAnomaly({ deviations: 3.5 })])

    await snapshotAnomaliesForAllOrgs()
    expect(mockDeliverToChannel).not.toHaveBeenCalled()
  })

  it('notifies configured channels for high-severity anomalies (≥ HIGH_SEVERITY_SIGMA)', async () => {
    setupFrom({ channels: [{ kind: 'slack', target: 'https://hooks.slack.com/test' }] })
    mockDetectAnomalies.mockResolvedValue([makeAnomaly({ deviations: 6 })])
    mockDeliverToChannel.mockResolvedValue({ ok: true })

    const results = await snapshotAnomaliesForAllOrgs()
    expect(results[0]!.errors).toEqual([])
    expect(mockDeliverToChannel).toHaveBeenCalledOnce()
    expect(mockDeliverToChannel).toHaveBeenCalledWith(
      'slack',
      'https://hooks.slack.com/test',
      expect.objectContaining({ alertType: 'latency_p95' }),
    )
  })

  it('notifies once per channel per anomaly', async () => {
    setupFrom({
      channels: [
        { kind: 'email', target: 'a@test.com' },
        { kind: 'slack', target: 'https://hooks.slack.com/1' },
      ],
    })
    mockDetectAnomalies.mockResolvedValue([makeAnomaly({ deviations: 6 })])
    mockDeliverToChannel.mockResolvedValue({ ok: true })

    await snapshotAnomaliesForAllOrgs()
    expect(mockDeliverToChannel).toHaveBeenCalledTimes(2)
  })

  it('skips notification when no channels configured', async () => {
    setupFrom({ channels: [] })
    mockDetectAnomalies.mockResolvedValue([makeAnomaly({ deviations: 8 })])

    await snapshotAnomaliesForAllOrgs()
    expect(mockDeliverToChannel).not.toHaveBeenCalled()
  })
})

describe('snapshotAnomaliesForAllOrgs — error handling', () => {
  it('continues processing remaining orgs when one org throws', async () => {
    setupFrom({ orgIds: ['org-1', 'org-2'] })
    mockDetectAnomalies
      .mockRejectedValueOnce(new Error('DB timeout'))
      .mockResolvedValueOnce([])

    const results = await snapshotAnomaliesForAllOrgs()
    expect(results).toHaveLength(2)
    expect(results[0]!.errors).toContain('DB timeout')
    expect(results[1]!.errors).toEqual([])
  })

  it('records upsert failure as error', async () => {
    setupFrom({ upsertError: { message: 'unique violation' }, channels: [] })
    mockDetectAnomalies.mockResolvedValue([makeAnomaly()])

    const results = await snapshotAnomaliesForAllOrgs()
    expect(results[0]!.errors[0]).toMatch('unique violation')
  })

  it('records notification failure without stopping batch', async () => {
    setupFrom({ channels: [{ kind: 'discord', target: 'https://discord.com/webhook' }] })
    mockDetectAnomalies.mockResolvedValue([makeAnomaly({ deviations: 7 })])
    mockDeliverToChannel.mockRejectedValue(new Error('network error'))

    const results = await snapshotAnomaliesForAllOrgs()
    expect(results[0]!.errors).toContain('notify: network error')
    expect(results[0]!.detected).toBe(1)
  })
})
