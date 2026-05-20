import { describe, it, expect } from 'vitest'
import { toClickhouseTimestamp, fromClickhouseTimestamp } from './clickhouse.js'

describe('toClickhouseTimestamp', () => {
  it("strips T and Z so ClickHouse's DateTime64 parser accepts it", () => {
    const fixed = new Date('2026-05-20T07:00:00.000Z')
    expect(toClickhouseTimestamp(fixed)).toBe('2026-05-20 07:00:00.000')
  })

  it('defaults to now when no Date is passed', () => {
    const out = toClickhouseTimestamp()
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/)
    expect(out).not.toContain('T')
    expect(out).not.toContain('Z')
  })
})

describe('fromClickhouseTimestamp', () => {
  it('round-trips with toClickhouseTimestamp', () => {
    const original = new Date('2026-05-20T07:00:00.000Z')
    const ch = toClickhouseTimestamp(original)
    const iso = fromClickhouseTimestamp(ch)
    expect(new Date(iso!).toISOString()).toBe('2026-05-20T07:00:00.000Z')
  })

  it('produces a string that JS Date parses as UTC, not local time', () => {
    // Symptom of the bug this helper fixes: without the Z suffix, a Korean
    // (UTC+9) browser interprets "2026-05-20 07:00:00.000" as 07:00 KST =
    // 22:00 UTC the previous day. The helper must add the Z back so the
    // parsed UTC time matches what ClickHouse stored.
    const ch = '2026-05-20 07:00:00.000'
    const iso = fromClickhouseTimestamp(ch)
    expect(iso).toBe('2026-05-20T07:00:00.000Z')
    // The parsed UTC hours must be 07, regardless of the runtime timezone.
    expect(new Date(iso!).getUTCHours()).toBe(7)
    expect(new Date(iso!).getUTCDate()).toBe(20)
  })

  it('returns null for null/undefined/empty input', () => {
    expect(fromClickhouseTimestamp(null)).toBeNull()
    expect(fromClickhouseTimestamp(undefined)).toBeNull()
    expect(fromClickhouseTimestamp('')).toBeNull()
  })

  it('handles timestamps without sub-second precision (some CH columns)', () => {
    expect(fromClickhouseTimestamp('2026-05-20 07:00:00')).toBe('2026-05-20T07:00:00Z')
  })
})
