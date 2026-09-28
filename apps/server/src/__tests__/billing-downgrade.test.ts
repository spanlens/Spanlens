import { beforeEach, describe, expect, test, vi } from 'vitest'
import { FakeSupabase, type Row } from './helpers/fake-supabase.js'

// ─────────────────────────────────────────────────────────────────────────────
// P2.7 auto-downgrade orchestration, reworked for the 2026-09-28 billing audit
// (C3.2). The cron flips paying orgs to Free after 7 days of payment failure
// and emails warnings at D-3 / D-1. A regression here either downgrades too
// aggressively (revenue + trust damage) or never (free LLM traffic forever).
//
// What the audit found, and what these tests pin:
//   * the dedupe key had no delinquency cycle, so a second delinquency after
//     recovery was never warned about or downgraded (23505 on every stage);
//   * the marker was written BEFORE the plan change and every write's
//     { error } was ignored, so a failed downgrade counted as done and was
//     never retried;
//   * an email that failed to send was never re-sent (marker first);
//   * no re-check that the subscription was still past due.
//
// The state change itself is `apply_past_due_downgrade` (SQL, asserted in
// supabase/tests/billing-rpc-smoke.sql). The fake's RPC handler below mirrors
// its contract so the orchestration can be driven end to end.
// ─────────────────────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000

const getUserByIdMock = vi.fn()
const sendEmailMock = vi.fn()
const renderPastDueEmailMock = vi.fn()

let fake: FakeSupabase

vi.mock('../lib/db.js', () => ({
  supabaseAdmin: {
    from: (t: string) => fake.from(t),
    rpc: (fn: string, p: Record<string, unknown>) => fake.rpc(fn, p),
    auth: { admin: { getUserById: (...args: unknown[]) => getUserByIdMock(...args) } },
  },
}))

vi.mock('../lib/resend.js', () => ({
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
  renderPastDueEmail: (...args: unknown[]) => renderPastDueEmailMock(...args),
}))

let runDowngradeCheck: typeof import('../lib/billing-downgrade.js').runDowngradeCheck

function daysAgo(days: number, from = Date.now()): string {
  return new Date(from - days * DAY_MS).toISOString()
}

/** Mirrors apply_past_due_downgrade: CAS, recompute (single sub → free), queue email. */
function installDowngradeRpc(): void {
  fake.onRpc('apply_past_due_downgrade', async (params) => {
    const sub = fake.rows('subscriptions').find((s) => s['id'] === params['p_subscription_id'])
    const matches =
      sub &&
      sub['past_due_since'] === params['p_past_due_since'] &&
      (sub['status'] === 'past_due' || sub['status'] === 'paused')
    if (!sub || !matches) return { data: { outcome: 'stale' }, error: null }
    // Direct row edits: these model writes made INSIDE the SQL function, so
    // they must not show up in fake.writes (which tracks the cron's own).
    sub['past_due_since'] = null
    const org = fake.rows('organizations').find((o) => o['id'] === sub['organization_id'])!
    const fromPlan = org['plan']
    org['plan'] = 'free'
    await fake.from('billing_downgrade_notifications').insert({
      subscription_id: sub['id'],
      stage: 'downgraded',
      cycle_started_at: params['p_past_due_since'],
    })
    return {
      data: { outcome: 'downgraded', organization_id: sub['organization_id'], from_plan: fromPlan, to_plan: 'free', email_queued: true },
      error: null,
    }
  })
}

function setup(subs: Row[], opts: { ownerEmail?: string | null } = {}): void {
  fake = new FakeSupabase()
    .configure('billing_downgrade_notifications', {
      defaults: () => ({ status: 'pending', attempts: 0, last_attempt_at: null, last_error: null, sent_at: null }),
      unique: [{ columns: ['subscription_id', 'stage', 'cycle_started_at'], nullsNotDistinct: true }],
      relations: { subscriptions: { localKey: 'subscription_id', foreignTable: 'subscriptions', foreignKey: 'id' } },
    })
    .seed('organizations', [
      { id: 'org_1', name: 'Acme', owner_id: opts.ownerEmail === null ? null : 'usr_owner', plan: 'team' },
      { id: 'org_2', name: 'Beta', owner_id: 'usr_owner', plan: 'team' },
    ])
    .seed('subscriptions', subs)
  installDowngradeRpc()
  getUserByIdMock.mockResolvedValue({
    data: { user: opts.ownerEmail === null ? null : { email: opts.ownerEmail ?? 'owner@example.com' } },
    error: null,
  })
}

function sub(overrides: Row): Row {
  return {
    id: 's_1',
    organization_id: 'org_1',
    status: 'past_due',
    paddle_subscription_id: 'sub_paddle_1',
    ...overrides,
  }
}

function markers(stage?: string): Row[] {
  return fake.rows('billing_downgrade_notifications').filter((m) => !stage || m['stage'] === stage)
}

beforeEach(async () => {
  vi.resetModules()
  getUserByIdMock.mockReset()
  sendEmailMock.mockReset().mockResolvedValue({ sent: true, id: 'em_1' })
  renderPastDueEmailMock.mockReset().mockReturnValue({ subject: 'mock', html: '<p>mock</p>' })
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  ;({ runDowngradeCheck } = await import('../lib/billing-downgrade.js'))
})

describe('runDowngradeCheck — staging', () => {
  test('no past_due rows → all counters zero, no email', async () => {
    setup([])
    const result = await runDowngradeCheck()
    expect(result).toEqual({
      scanned: 0,
      warningsD3: 0,
      warningsD1: 0,
      downgraded: 0,
      downgradeNoticesSent: 0,
      emailsSkipped: 0,
      staleSkipped: 0,
      emailsFailed: 0,
      errors: [],
    })
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  test('past_due_since < 4 days → nothing queued, no email', async () => {
    setup([sub({ past_due_since: daysAgo(2) })])
    const result = await runDowngradeCheck()
    expect(result.scanned).toBe(1)
    expect(markers()).toHaveLength(0)
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  test('4 days → D-3 queued for THIS cycle, sent, then marked sent', async () => {
    const since = daysAgo(4)
    setup([sub({ past_due_since: since })])
    const result = await runDowngradeCheck()
    expect(result.warningsD3).toBe(1)
    expect(sendEmailMock).toHaveBeenCalledOnce()
    expect(renderPastDueEmailMock).toHaveBeenCalledWith(expect.objectContaining({ stage: 'warning-d3', pastDueSince: since }))
    expect(markers('warning-d3')).toEqual([
      expect.objectContaining({ cycle_started_at: since, status: 'sent', attempts: 1, sent_at: expect.any(String) }),
    ])
  })

  test('6 days → D-1 sent', async () => {
    setup([sub({ past_due_since: daysAgo(6) })])
    const result = await runDowngradeCheck()
    expect(result.warningsD1).toBe(1)
    expect(renderPastDueEmailMock).toHaveBeenCalledWith(expect.objectContaining({ stage: 'warning-d1' }))
  })

  test('>= 7 days → one atomic RPC with the exact cycle start, then the queued notice is sent', async () => {
    const since = daysAgo(8)
    setup([sub({ past_due_since: since })])
    const result = await runDowngradeCheck()
    expect(fake.rpcCalls).toEqual([
      { fn: 'apply_past_due_downgrade', params: { p_subscription_id: 's_1', p_past_due_since: since } },
    ])
    expect(result.downgraded).toBe(1)
    expect(result.downgradeNoticesSent).toBe(1)
    expect(fake.rows('organizations').find((o) => o['id'] === 'org_1')!['plan']).toBe('free')
    expect(renderPastDueEmailMock).toHaveBeenCalledWith(expect.objectContaining({ stage: 'downgraded' }))
    expect(markers('downgraded')[0]).toMatchObject({ status: 'sent' })
    // The cron no longer writes organizations / subscriptions / audit_logs
    // itself: those happen inside the RPC transaction.
    expect(fake.writes.filter((w) => w.table === 'organizations' || w.table === 'audit_logs')).toEqual([])
  })

  test('only past_due / paused rows are scanned (a canceled row keeps past_due_since for analytics)', async () => {
    setup([sub({ past_due_since: daysAgo(9), status: 'canceled' })])
    const result = await runDowngradeCheck()
    expect(result.scanned).toBe(0)
    expect(fake.rpcCalls).toHaveLength(0)
  })
})

describe('runDowngradeCheck — idempotency and cycles', () => {
  test('re-run the same day after D-3 was sent → emailsSkipped, no second email', async () => {
    setup([sub({ past_due_since: daysAgo(4) })])
    await runDowngradeCheck()
    const second = await runDowngradeCheck()
    expect(second.emailsSkipped).toBe(1)
    expect(second.warningsD3).toBe(0)
    expect(sendEmailMock).toHaveBeenCalledOnce()
  })

  test('a NEW delinquency cycle after recovery warns again (old key blocked it forever)', async () => {
    const oldCycle = daysAgo(40)
    const newCycle = daysAgo(4)
    setup([sub({ past_due_since: newCycle })])
    fake.seed('billing_downgrade_notifications', [
      { subscription_id: 's_1', stage: 'warning-d3', cycle_started_at: oldCycle, status: 'sent', created_at: daysAgo(36) },
      { subscription_id: 's_1', stage: 'downgraded', cycle_started_at: oldCycle, status: 'sent', created_at: daysAgo(33) },
    ])
    const result = await runDowngradeCheck()
    expect(result.warningsD3).toBe(1)
    expect(result.emailsSkipped).toBe(0)
    expect(markers('warning-d3')).toHaveLength(2)
  })
})

describe('runDowngradeCheck — failures are retried, never counted as done', () => {
  test('RPC error → recorded in errors, not counted, retried on the next run', async () => {
    const since = daysAgo(8)
    setup([sub({ past_due_since: since })])
    const realRpc = fake.rpcHandlers.get('apply_past_due_downgrade')!
    fake.onRpc('apply_past_due_downgrade', () => ({ data: null, error: { message: 'deadlock detected' } }))

    const first = await runDowngradeCheck()
    expect(first.downgraded).toBe(0)
    expect(first.errors).toEqual([expect.stringContaining('deadlock detected')])
    expect(fake.rows('organizations').find((o) => o['id'] === 'org_1')!['plan']).toBe('team')
    expect(markers()).toHaveLength(0)

    fake.onRpc('apply_past_due_downgrade', realRpc)
    const second = await runDowngradeCheck()
    expect(second.downgraded).toBe(1)
    expect(second.errors).toEqual([])
  })

  test('RPC reports stale (recovered / changed cycle) → staleSkipped, nothing sent', async () => {
    setup([sub({ past_due_since: daysAgo(8) })])
    fake.onRpc('apply_past_due_downgrade', () => ({ data: { outcome: 'stale' }, error: null }))
    const result = await runDowngradeCheck()
    expect(result.staleSkipped).toBe(1)
    expect(result.downgraded).toBe(0)
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  test('marker insert failing with something other than 23505 → error, no email', async () => {
    setup([sub({ past_due_since: daysAgo(4) })])
    fake.failNext('billing_downgrade_notifications', 'insert', { message: 'connection refused' })
    const result = await runDowngradeCheck()
    expect(result.errors).toEqual([expect.stringContaining('connection refused')])
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  test('send failure keeps the marker pending, and the next run re-sends it', async () => {
    setup([sub({ past_due_since: daysAgo(4) })])
    sendEmailMock.mockResolvedValueOnce({ sent: false, error: 'Resend 503: unavailable' })

    const first = await runDowngradeCheck()
    expect(first.warningsD3).toBe(0)
    expect(first.emailsFailed).toBe(1)
    expect(first.errors).toEqual([expect.stringContaining('Resend 503')])
    expect(markers('warning-d3')[0]).toMatchObject({ status: 'pending', attempts: 1, last_error: 'Resend 503: unavailable' })

    // A second scheduler firing minutes later must not hammer the provider.
    const sameHour = await runDowngradeCheck()
    expect(sameHour.emailsFailed).toBe(0)
    expect(sendEmailMock).toHaveBeenCalledTimes(1)

    const nextDay = await runDowngradeCheck(new Date(Date.now() + 21 * HOUR_MS))
    expect(nextDay.warningsD3).toBe(1)
    expect(markers('warning-d3')[0]).toMatchObject({ status: 'sent', attempts: 2 })
  })

  test('a send that throws is handled like a failed send', async () => {
    setup([sub({ past_due_since: daysAgo(4) })])
    sendEmailMock.mockRejectedValueOnce(new Error('socket hang up'))
    const result = await runDowngradeCheck()
    expect(result.emailsFailed).toBe(1)
    expect(markers('warning-d3')[0]).toMatchObject({ status: 'pending', last_error: 'socket hang up' })
  })

  test('the downgrade notice is retried after its subscription left the scan', async () => {
    setup([sub({ past_due_since: daysAgo(8) })])
    sendEmailMock.mockResolvedValueOnce({ sent: false, error: 'Resend 500' })
    const first = await runDowngradeCheck()
    expect(first.downgraded).toBe(1)
    expect(first.downgradeNoticesSent).toBe(0)

    // past_due_since is now NULL, so the scan no longer sees the row; the
    // outbox drain still owns the unsent notice.
    const next = await runDowngradeCheck(new Date(Date.now() + 21 * HOUR_MS))
    expect(next.scanned).toBe(0)
    expect(next.downgradeNoticesSent).toBe(1)
  })

  test('after the last allowed attempt the marker is marked failed', async () => {
    setup([sub({ past_due_since: daysAgo(4) })])
    fake.seed('billing_downgrade_notifications', [{
      subscription_id: 's_1',
      stage: 'warning-d3',
      cycle_started_at: fake.rows('subscriptions')[0]!['past_due_since'],
      status: 'pending',
      attempts: 4,
      last_attempt_at: daysAgo(1),
    }])
    sendEmailMock.mockResolvedValueOnce({ sent: false, error: 'Resend 500' })
    const result = await runDowngradeCheck()
    expect(result.emailsFailed).toBe(1)
    expect(markers('warning-d3')[0]).toMatchObject({ status: 'failed', attempts: 5 })
  })

  test('a drain read error is reported, not swallowed', async () => {
    setup([])
    fake.failNext('billing_downgrade_notifications', 'select', { message: 'timeout' })
    const result = await runDowngradeCheck()
    expect(result.errors).toEqual([expect.stringContaining('timeout')])
  })

  test('the scan read error is reported', async () => {
    setup([])
    fake.failNext('subscriptions', 'select', { message: 'connection refused' })
    const result = await runDowngradeCheck()
    expect(result.errors[0]).toMatch(/select past_due rows failed.*connection refused/)
  })
})

describe('runDowngradeCheck — outbox skip rules', () => {
  test('a warning whose cycle recovered before sending is skipped, not sent', async () => {
    const since = daysAgo(4)
    setup([sub({ past_due_since: null, status: 'active' })])
    fake.seed('billing_downgrade_notifications', [{
      subscription_id: 's_1', stage: 'warning-d3', cycle_started_at: since, status: 'pending', attempts: 0,
    }])
    await runDowngradeCheck()
    expect(sendEmailMock).not.toHaveBeenCalled()
    expect(markers('warning-d3')[0]).toMatchObject({ status: 'skipped' })
  })

  test('a warning older than its TTL is skipped (the next stage supersedes it)', async () => {
    const since = daysAgo(6)
    setup([sub({ past_due_since: since })])
    fake.seed('billing_downgrade_notifications', [{
      subscription_id: 's_1', stage: 'warning-d3', cycle_started_at: since, status: 'pending', attempts: 1,
      created_at: daysAgo(2), last_attempt_at: daysAgo(2),
    }])
    const result = await runDowngradeCheck()
    expect(markers('warning-d3')[0]).toMatchObject({ status: 'skipped', last_error: 'expired' })
    expect(result.warningsD1).toBe(1)
    expect(sendEmailMock).toHaveBeenCalledOnce()
  })

  test('no owner email → skipped with a reason, not retried forever', async () => {
    setup([sub({ past_due_since: daysAgo(4) })], { ownerEmail: null })
    await runDowngradeCheck()
    expect(sendEmailMock).not.toHaveBeenCalled()
    expect(markers('warning-d3')[0]).toMatchObject({ status: 'skipped', last_error: 'no owner email' })
  })

  test('email provider not configured (dev) → skipped, not failed', async () => {
    setup([sub({ past_due_since: daysAgo(4) })])
    sendEmailMock.mockResolvedValueOnce({ sent: false })
    const result = await runDowngradeCheck()
    expect(result.emailsFailed).toBe(0)
    expect(markers('warning-d3')[0]).toMatchObject({ status: 'skipped', last_error: 'email provider not configured' })
  })

  test('two concurrent runs send the email once', async () => {
    setup([sub({ past_due_since: daysAgo(4) })])
    await Promise.all([runDowngradeCheck(), runDowngradeCheck()])
    expect(sendEmailMock).toHaveBeenCalledOnce()
  })
})
