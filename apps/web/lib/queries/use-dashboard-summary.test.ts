import { describe, expect, it } from 'vitest'
import {
  DASHBOARD_DATASETS,
  dashboardPanelState,
  toDashboardSummaryResult,
  type DashboardSummaryResult,
} from './use-dashboard-summary'

/**
 * GET /api/v1/dashboard/summary answers 200 even when some of its six
 * datasets failed: a failed one comes back as `null` and is named in
 * `meta.degraded`. The hook used to return `res.data` alone, so the
 * dashboard could not tell "failed" from "nothing to show" and rendered a
 * failed alerts lookup as "No active alert rules" and a failed security
 * lookup as no PII warning at all.
 */

// The server's forecast never succeeds as null, so a clean read carries one.
const FORECAST = { monthToDate: 1 } as never

const CLEAN = {
  alerts: [],
  recommendations: [],
  auditLogs: [],
  prompts: [],
  securitySummary: [],
  spendForecast: FORECAST,
}

describe('toDashboardSummaryResult', () => {
  it('keeps the datasets and reports nothing degraded on a clean read', () => {
    const result = toDashboardSummaryResult({
      data: CLEAN,
      meta: { degraded: [] },
    })
    expect(result.degraded).toEqual([])
    expect(result.data.alerts).toEqual([])
  })

  it('carries meta.degraded through instead of dropping it', () => {
    const result = toDashboardSummaryResult({
      data: { ...CLEAN, securitySummary: null, alerts: null },
      meta: { degraded: ['alerts', 'securitySummary'] },
    })
    expect(result.degraded).toEqual(['alerts', 'securitySummary'])
  })

  it('treats a null dataset as degraded even when meta is missing', () => {
    const result = toDashboardSummaryResult({ data: { ...CLEAN, auditLogs: null } })
    expect(result.degraded).toEqual(['auditLogs'])
  })

  it('ignores unknown names the server might add later', () => {
    const result = toDashboardSummaryResult({
      data: CLEAN,
      meta: { degraded: ['somethingNew'] },
    })
    expect(result.degraded).toEqual([])
  })

  it('treats a missing payload as every dataset unavailable', () => {
    const result = toDashboardSummaryResult({})
    expect(result.degraded).toEqual([...DASHBOARD_DATASETS])
  })
})

describe('dashboardPanelState', () => {
  const ok: DashboardSummaryResult = { data: CLEAN, degraded: [] }
  const alertsDown: DashboardSummaryResult = { data: { ...CLEAN, alerts: null }, degraded: ['alerts'] }

  it('is loading before the first response', () => {
    expect(dashboardPanelState({ data: undefined, isError: false }, 'alerts')).toBe('loading')
  })

  it('is ready when the dataset loaded, even if empty', () => {
    expect(dashboardPanelState({ data: ok, isError: false }, 'alerts')).toBe('ready')
  })

  it('is unavailable when the server reported that dataset as failed', () => {
    expect(dashboardPanelState({ data: alertsDown, isError: false }, 'alerts')).toBe('unavailable')
    expect(dashboardPanelState({ data: alertsDown, isError: false }, 'prompts')).toBe('ready')
  })

  it('is unavailable for every panel when the whole request failed', () => {
    for (const key of DASHBOARD_DATASETS) {
      expect(dashboardPanelState({ data: undefined, isError: true }, key)).toBe('unavailable')
    }
  })

  it('keeps showing the last good read when a refetch fails', () => {
    expect(dashboardPanelState({ data: ok, isError: true }, 'alerts')).toBe('ready')
  })
})
