import { describe, expect, it } from 'vitest'
import {
  anomalyMatchesFilters,
  appendRequestsFilters,
  buildRequestsExportPath,
  compactRequestsFilters,
  parseTruncatedParam,
} from './requests-filters'

/**
 * One filter set drives three reads on /requests: the table, the KPI strip +
 * traffic chart (via /stats), and the export. Each used to pick its own
 * subset, so an export from `/requests?userId=customer-a` downloaded every
 * customer's rows, and the KPI strip ignored every filter but time.
 */

const KEY_ID = '11111111-1111-4111-8111-111111111111'
const PROMPT_ID = '22222222-2222-4222-8222-222222222222'

describe('compactRequestsFilters', () => {
  it('drops blank values', () => {
    expect(compactRequestsFilters({ provider: 'openai', model: '  ', userId: '' })).toEqual({ provider: 'openai' })
  })

  it('returns undefined when nothing is set, so an unfiltered query key stays unchanged', () => {
    // The dashboard's overview/timeseries keys are prefetched on the server
    // with no filters. Adding an empty `filters: {}` to the key would miss
    // that cache entry and refetch on every page load.
    expect(compactRequestsFilters({})).toBeUndefined()
    expect(compactRequestsFilters(undefined)).toBeUndefined()
    expect(compactRequestsFilters({ model: ' ' })).toBeUndefined()
  })

  it('trims the model search', () => {
    expect(compactRequestsFilters({ model: ' gpt-4o ' })).toEqual({ model: 'gpt-4o' })
  })
})

describe('appendRequestsFilters', () => {
  it('adds every set filter to a copy of the query string', () => {
    const base = new URLSearchParams({ from: '2026-09-01T00:00:00.000Z' })
    const qs = appendRequestsFilters(base, {
      provider: 'anthropic',
      model: 'claude',
      providerKeyId: KEY_ID,
      status: '5xx',
      promptVersionId: PROMPT_ID,
      userId: 'customer-a',
      sessionId: 'sess-9',
      truncated: 'true',
    })
    expect(Object.fromEntries(qs)).toEqual({
      from: '2026-09-01T00:00:00.000Z',
      provider: 'anthropic',
      model: 'claude',
      providerKeyId: KEY_ID,
      status: '5xx',
      promptVersionId: PROMPT_ID,
      userId: 'customer-a',
      sessionId: 'sess-9',
      truncated: 'true',
    })
    expect(base.has('provider')).toBe(false)
  })
})

describe('buildRequestsExportPath', () => {
  it('exports exactly what the table is filtered to', () => {
    const path = buildRequestsExportPath('csv', {
      provider: 'openai',
      model: 'gpt-4o',
      providerKeyId: KEY_ID,
      status: '4xx',
      promptVersionId: PROMPT_ID,
      userId: 'customer-a',
      sessionId: 'sess-1',
      truncated: 'false',
    }, '2026-09-28T00:00:00.000Z')
    const [pathname, query] = path.split('?')
    expect(pathname).toBe('/api/v1/exports/requests')
    expect(Object.fromEntries(new URLSearchParams(query))).toEqual({
      format: 'csv',
      provider: 'openai',
      model: 'gpt-4o',
      providerKeyId: KEY_ID,
      status: '4xx',
      promptVersionId: PROMPT_ID,
      userId: 'customer-a',
      sessionId: 'sess-1',
      truncated: 'false',
      from: '2026-09-28T00:00:00.000Z',
    })
  })

  it('carries the user filter the customer cost walkthrough relies on', () => {
    // docs/customer-cost-walkthrough opens /requests?userId=... and tells the
    // reader to export the filtered requests.
    const query = buildRequestsExportPath('jsonl', { userId: 'example-customer-a' }).split('?')[1]
    expect(new URLSearchParams(query).get('userId')).toBe('example-customer-a')
  })

  it('omits unset filters and the lower bound for all time', () => {
    const query = buildRequestsExportPath('json', {}).split('?')[1]
    expect(Object.fromEntries(new URLSearchParams(query))).toEqual({ format: 'json' })
  })
})

describe('parseTruncatedParam', () => {
  it('accepts true/false and ignores anything else', () => {
    expect(parseTruncatedParam('true')).toBe('true')
    expect(parseTruncatedParam('false')).toBe('false')
    expect(parseTruncatedParam('yes')).toBeUndefined()
    expect(parseTruncatedParam(null)).toBeUndefined()
  })
})

describe('anomalyMatchesFilters', () => {
  const anomaly = { provider: 'openai', model: 'gpt-4o-mini-2024-07-18' }

  it('matches when no provider or model filter is set', () => {
    expect(anomalyMatchesFilters(anomaly, undefined)).toBe(true)
    expect(anomalyMatchesFilters(anomaly, { userId: 'customer-a' })).toBe(true)
  })

  it('narrows by provider and by literal, case-insensitive model substring', () => {
    expect(anomalyMatchesFilters(anomaly, { provider: 'openai' })).toBe(true)
    expect(anomalyMatchesFilters(anomaly, { provider: 'anthropic' })).toBe(false)
    expect(anomalyMatchesFilters(anomaly, { model: 'GPT-4O-MINI' })).toBe(true)
    expect(anomalyMatchesFilters(anomaly, { model: 'gpt-4o_mini' })).toBe(false)
  })
})
