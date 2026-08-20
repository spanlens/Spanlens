import { describe, expect, test } from 'vitest'
import {
  shouldScanRequests,
  DATA_SILENCE_WINDOW_HOURS,
  type OpenEpisode,
} from '../lib/data-silence.js'

/**
 * detect-data-silence × activity watermark.
 *
 * Ungated, this job scans `requests` across every tenant four times a day
 * for a report that on a quiet platform is empty. Only one of its decisions
 * actually needs that scan: whether a newly-silent org's prior week clears
 * the alert threshold. Resolving and retrying reduce to "does this org have
 * traffic in the last 24h", which the watermark answers exactly.
 *
 * The cases below pin the gate in both directions. Skipping when an alert
 * was due would be a silent product regression, so every branch that could
 * produce a new episode has to keep scanning — including the one that made
 * this worth writing as a pure function: an org that has been dormant past
 * the whole lookback drops out of the candidate set for good instead of
 * triggering a scan every six hours forever.
 */

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const NOW = Date.parse('2026-08-18T12:00:00.000Z')
const SILENT_AT = NOW - (DATA_SILENCE_WINDOW_HOURS + 1) * HOUR

function episode(orgId: string): OpenEpisode {
  return {
    id: `ep-${orgId}`,
    organization_id: orgId,
    email_sent: true,
    last_request_at: null,
    prior_week_requests: 100,
  }
}

describe('shouldScanRequests', () => {
  test('scans when an org went silent and has no episode yet', () => {
    const activity = new Map([['org-1', SILENT_AT]])
    expect(shouldScanRequests(activity, [], NOW)).toBe(true)
  })

  test('skips when the only silent org already has an open episode', () => {
    const activity = new Map([['org-1', SILENT_AT]])
    expect(shouldScanRequests(activity, [episode('org-1')], NOW)).toBe(false)
  })

  test('skips when every org has recent traffic', () => {
    const activity = new Map([
      ['org-1', NOW - HOUR],
      ['org-2', NOW - 2 * HOUR],
    ])
    expect(shouldScanRequests(activity, [], NOW)).toBe(false)
  })

  test('skips when nothing has been logged at all', () => {
    expect(shouldScanRequests(new Map(), [], NOW)).toBe(false)
  })

  test('scans when any one org qualifies, even among alerted ones', () => {
    const activity = new Map([
      ['org-1', SILENT_AT],
      ['org-2', SILENT_AT],
    ])
    expect(shouldScanRequests(activity, [episode('org-1')], NOW)).toBe(true)
  })

  test('an org dormant past the lookback is not a candidate', () => {
    // Absent from the map: getOrgActivitySince only returns orgs inside the
    // lookback, so a long-dormant org has prior_count 0 and can never open
    // an episode. This is what stops the gate degrading back to a scan every
    // six hours forever.
    expect(shouldScanRequests(new Map(), [episode('org-1')], NOW)).toBe(false)
  })

  test('treats the silence boundary as still-active', () => {
    const activity = new Map([['org-1', NOW - DATA_SILENCE_WINDOW_HOURS * HOUR]])
    expect(shouldScanRequests(activity, [], NOW)).toBe(false)
  })

  test('scans when the watermark is unreadable', () => {
    // Fail-open: a broken watermark must not be able to suppress an alert.
    expect(shouldScanRequests(null, [], NOW)).toBe(true)
    expect(shouldScanRequests(null, [episode('org-1')], NOW)).toBe(true)
  })

  test('a week-old but not dormant org still triggers a scan', () => {
    const activity = new Map([['org-1', NOW - 6 * DAY]])
    expect(shouldScanRequests(activity, [], NOW)).toBe(true)
  })
})
