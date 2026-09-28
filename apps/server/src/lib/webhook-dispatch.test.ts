import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createHmac, randomUUID } from 'node:crypto'

/**
 * lib/webhook-dispatch.ts against an in-memory stand-in for the two tables it
 * touches. The stand-in follows the real contracts that matter here:
 *
 *   - supabase-js never rejects on a database error. It resolves
 *     `{ data: null, error }`, so failures are injected that way. Mocking a
 *     rejection would hide exactly the bug C12.1 describes (a failed queue
 *     read that resolved to "zero work" and was logged as a successful run).
 *   - `claim_webhook_deliveries` mirrors the SQL in
 *     20260929120000_webhook_delivery_claim.sql: the due filter, the lease,
 *     the attempt_count bump, a fresh token per row. The SQL itself is checked
 *     against Postgres separately; this suite checks that the server uses it
 *     correctly.
 *   - every call yields to the event loop before it runs, so two overlapping
 *     runs interleave the way two serverless invocations would.
 *
 * The transport (lib/safe-http.ts) is mocked; its own suite runs it against
 * real sockets.
 */

type Transport = (
  url: string,
  opts: { headers: Record<string, string>; body: string },
) => Promise<{ status: number | null; error: string | null }>

const sendMock = vi.fn<Transport>()

vi.mock('./safe-http.js', () => ({
  safePost: (url: string, opts: { headers: Record<string, string>; body: string }) =>
    sendMock(url, opts),
}))

interface DeliveryRow {
  id: string
  webhook_id: string
  event_type: string
  status: 'success' | 'failed'
  http_status: number | null
  error_message: string | null
  duration_ms: number | null
  payload: Record<string, unknown> | null
  attempt_count: number
  next_retry_at: string | null
  dlq_at: string | null
  dlq_reason: string | null
  claimed_until: string | null
  claim_token: string | null
}

interface HookRow {
  id: string
  url: string
  secret: string
  is_active: boolean
}

type Row = Record<string, unknown>
type DbError = { message: string } | null

const db = {
  deliveries: new Map<string, DeliveryRow>(),
  webhooks: new Map<string, HookRow>(),
}
const injected: { queueRead: DbError; update: DbError; insert: DbError } = {
  queueRead: null,
  update: null,
  insert: null,
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))
const iso = (ms: number): string => new Date(ms).toISOString()

function tableRows(table: string): Row[] {
  if (table === 'webhook_deliveries') {
    return [...db.deliveries.values()].map((d) => ({
      ...d,
      webhooks: db.webhooks.get(d.webhook_id) ?? null,
    }))
  }
  if (table === 'webhooks') return [...db.webhooks.values()] as unknown as Row[]
  return []
}

function compare(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return Date.parse(String(a)) - Date.parse(String(b))
}

/** Just enough of the PostgREST builder for this module. */
class FakeQuery implements PromiseLike<{ data: unknown; error: DbError; count?: number }> {
  private op: 'select' | 'insert' | 'update' = 'select'
  private filters: Array<(r: Row) => boolean> = []
  private patch: Row = {}
  private inserted: Row[] = []
  private head = false
  private limitN: number | null = null
  private single = false

  constructor(private readonly table: string) {}

  select(_cols?: string, opts?: { head?: boolean }): this {
    if (this.op === 'select') this.head = opts?.head ?? false
    return this
  }
  insert(row: Row | Row[]): this {
    this.op = 'insert'
    this.inserted = Array.isArray(row) ? row : [row]
    return this
  }
  update(patch: Row): this {
    this.op = 'update'
    this.patch = patch
    return this
  }
  eq(col: string, v: unknown): this {
    this.filters.push((r) => r[col] === v)
    return this
  }
  lte(col: string, v: unknown): this {
    this.filters.push((r) => r[col] !== null && compare(r[col], v) <= 0)
    return this
  }
  lt(col: string, v: unknown): this {
    this.filters.push((r) => r[col] !== null && compare(r[col], v) < 0)
    return this
  }
  is(col: string, v: unknown): this {
    this.filters.push((r) => (r[col] ?? null) === v)
    return this
  }
  not(col: string, _op: 'is', v: unknown): this {
    this.filters.push((r) => (r[col] ?? null) !== v)
    return this
  }
  limit(n: number): this {
    this.limitN = n
    return this
  }
  order(): this {
    return this
  }
  maybeSingle(): this {
    this.single = true
    return this
  }
  then<A, B>(
    onFulfilled?: ((v: { data: unknown; error: DbError; count?: number }) => A | PromiseLike<A>) | null,
    onRejected?: ((e: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return tick().then(() => this.run()).then(onFulfilled, onRejected)
  }

  private run(): { data: unknown; error: DbError; count?: number } {
    const matches = tableRows(this.table).filter((r) => this.filters.every((f) => f(r)))
    if (this.op === 'insert') {
      if (injected.insert) return { data: null, error: injected.insert }
      const defaults = { dlq_at: null, dlq_reason: null, claimed_until: null, claim_token: null }
      for (const row of this.inserted) {
        const id = (row['id'] as string | undefined) ?? randomUUID()
        db.deliveries.set(id, { ...defaults, ...row, id } as unknown as DeliveryRow)
      }
      return { data: null, error: null }
    }
    if (this.op === 'update') {
      if (injected.update) return { data: null, error: injected.update }
      for (const r of matches) {
        const current = db.deliveries.get(r['id'] as string)!
        db.deliveries.set(current.id, { ...current, ...(this.patch as Partial<DeliveryRow>) })
      }
      return { data: null, error: null }
    }
    const limited = this.limitN === null ? matches : matches.slice(0, this.limitN)
    if (this.head) return { data: null, error: null, count: matches.length }
    if (this.single) return { data: limited[0] ?? null, error: null }
    return { data: limited, error: null }
  }
}

function claimWebhookDeliveries(args: {
  p_limit: number
  p_lease_seconds: number
  p_max_attempts: number
}): Row[] {
  const now = Date.now()
  const due = [...db.deliveries.values()]
    .filter(
      (d) =>
        d.status === 'failed' &&
        d.dlq_at === null &&
        d.next_retry_at !== null &&
        Date.parse(d.next_retry_at) <= now &&
        d.attempt_count < args.p_max_attempts &&
        (d.claimed_until === null || Date.parse(d.claimed_until) < now),
    )
    .sort((a, b) => compare(a.next_retry_at, b.next_retry_at))
    .slice(0, args.p_limit)

  return due.map((d) => {
    const claimed: DeliveryRow = {
      ...d,
      attempt_count: d.attempt_count + 1,
      claimed_until: iso(now + args.p_lease_seconds * 1000),
      claim_token: randomUUID(),
    }
    db.deliveries.set(d.id, claimed)
    const hook = db.webhooks.get(d.webhook_id)
    return {
      id: claimed.id,
      webhook_id: claimed.webhook_id,
      event_type: claimed.event_type,
      payload: claimed.payload,
      attempt_count: claimed.attempt_count,
      claim_token: claimed.claim_token,
      webhook_url: hook?.url ?? null,
      webhook_secret: hook?.secret ?? null,
      webhook_is_active: hook?.is_active ?? null,
    }
  })
}

const rpcMock = vi.fn(async (name: string, args: Record<string, number>) => {
  await tick()
  if (injected.queueRead) return { data: null, error: injected.queueRead }
  if (name !== 'claim_webhook_deliveries') return { data: null, error: { message: `no rpc ${name}` } }
  return {
    data: claimWebhookDeliveries(args as Parameters<typeof claimWebhookDeliveries>[0]),
    error: null,
  }
})

vi.mock('./db.js', () => ({
  supabaseAdmin: {
    from: (table: string) => new FakeQuery(table),
    rpc: (name: string, args: Record<string, number>) => rpcMock(name, args),
  },
}))

const {
  dispatchWebhookEvent,
  retryFailedWebhooks,
  sendWebhook,
} = await import('./webhook-dispatch.js')

// ── fixtures ────────────────────────────────────────────────────────────────

const T0 = Date.parse('2026-09-29T12:00:00.000Z')
const MINUTE = 60_000

function addHook(overrides: Partial<HookRow> = {}): HookRow {
  const hook: HookRow = {
    id: randomUUID(),
    url: 'https://hooks.example.com/spanlens',
    secret: 'whsec_test',
    is_active: true,
    ...overrides,
  }
  db.webhooks.set(hook.id, hook)
  return hook
}

function addDelivery(hook: HookRow, overrides: Partial<DeliveryRow> = {}): DeliveryRow {
  const row: DeliveryRow = {
    id: randomUUID(),
    webhook_id: hook.id,
    event_type: 'request.created',
    status: 'failed',
    http_status: 503,
    error_message: 'HTTP 503',
    duration_ms: 12,
    payload: { event: 'request.created', webhook_id: hook.id },
    attempt_count: 1,
    next_retry_at: iso(T0 - MINUTE),
    dlq_at: null,
    dlq_reason: null,
    claimed_until: null,
    claim_token: null,
    ...overrides,
  }
  db.deliveries.set(row.id, row)
  return row
}

const row = (id: string): DeliveryRow => db.deliveries.get(id)!

function respondWith(status: number | null, error: string | null = null): void {
  sendMock.mockImplementation(async () => {
    await tick()
    return { status, error }
  })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
  db.deliveries.clear()
  db.webhooks.clear()
  injected.queueRead = null
  injected.update = null
  injected.insert = null
  sendMock.mockReset()
  rpcMock.mockClear()
  respondWith(200)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// ── sendWebhook ─────────────────────────────────────────────────────────────

describe('sendWebhook', () => {
  test('signs the exact body it sends and carries the delivery id', async () => {
    const result = await sendWebhook('https://hooks.example.com/x', 'whsec_test', { a: 1 }, {
      deliveryId: 'del-123',
    })

    const [url, opts] = sendMock.mock.calls[0]!
    const expected = createHmac('sha256', 'whsec_test').update(opts.body).digest('hex')
    expect(url).toBe('https://hooks.example.com/x')
    expect(opts.body).toBe('{"a":1}')
    expect(opts.headers['X-Spanlens-Signature']).toBe(`sha256=${expected}`)
    expect(opts.headers['X-Spanlens-Delivery-Id']).toBe('del-123')
    expect(opts.headers['Content-Type']).toBe('application/json')
    expect(result.ok).toBe(true)
  })

  test('a non-2xx final status is a failure named after the status', async () => {
    respondWith(503)
    const result = await sendWebhook('https://hooks.example.com/x', 's', {})
    expect(result).toMatchObject({ ok: false, httpStatus: 503, errorMessage: 'HTTP 503' })
  })

  test('a transport error keeps the last status and reports the reason', async () => {
    respondWith(307, 'Redirect to 127.0.0.1:8080 rejected by SSRF guard: url must use https://')
    const result = await sendWebhook('https://hooks.example.com/x', 's', {})
    expect(result).toMatchObject({
      ok: false,
      httpStatus: 307,
      errorMessage: 'Redirect to 127.0.0.1:8080 rejected by SSRF guard: url must use https://',
    })
  })
})

// ── dispatchWebhookEvent ────────────────────────────────────────────────────

describe('dispatchWebhookEvent', () => {
  test('the delivery id sent in the header is the id of the row it records', async () => {
    const hook = addHook()

    const result = await dispatchWebhookEvent(hook, 'request.created', { request_id: 'r1' })

    const headerId = sendMock.mock.calls[0]![1].headers['X-Spanlens-Delivery-Id']
    expect(headerId).toMatch(/^[0-9a-f-]{36}$/)
    expect(result.deliveryId).toBe(headerId)
    expect(row(headerId!)).toMatchObject({ status: 'success', attempt_count: 1, next_retry_at: null })
  })

  test('a failed first attempt is queued for its first retry one minute later', async () => {
    respondWith(502)
    const hook = addHook()

    const result = await dispatchWebhookEvent(hook, 'request.created', {})

    expect(row(result.deliveryId)).toMatchObject({
      status: 'failed',
      http_status: 502,
      attempt_count: 1,
      next_retry_at: iso(T0 + MINUTE),
    })
  })

  test('a failed insert is reported, not hidden behind a made-up id', async () => {
    injected.insert = { message: 'insert failed' }
    const hook = addHook()

    const result = await dispatchWebhookEvent(hook, 'request.created', {})

    expect(result.deliveryId).toBe('')
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('WEBHOOK_DISPATCH_FAILED'))
  })
})

// ── retryFailedWebhooks ─────────────────────────────────────────────────────

describe('retryFailedWebhooks — queue read (C12.1)', () => {
  test('a failed claim fails the run instead of reporting zero work', async () => {
    addDelivery(addHook())
    injected.queueRead = { message: 'connection reset' }

    await expect(retryFailedWebhooks()).rejects.toThrow('connection reset')
    expect(sendMock).not.toHaveBeenCalled()
  })
})

describe('retryFailedWebhooks — claim (C12.2)', () => {
  test('two overlapping runs send each due delivery once and count one attempt', async () => {
    const hook = addHook()
    const a = addDelivery(hook)
    const b = addDelivery(hook)
    respondWith(503)

    const [first, second] = await Promise.all([retryFailedWebhooks(), retryFailedWebhooks()])

    const sentTo = sendMock.mock.calls.map(([, opts]) => opts.headers['X-Spanlens-Delivery-Id'])
    expect(sentTo.sort()).toEqual([a.id, b.id].sort())
    expect(first.retried + second.retried).toBe(2)
    expect(row(a.id).attempt_count).toBe(2)
    expect(row(b.id).attempt_count).toBe(2)
  })

  test('the retry reuses the original delivery id so receivers can drop duplicates', async () => {
    const d = addDelivery(addHook())

    await retryFailedWebhooks()

    expect(sendMock.mock.calls[0]![1].headers['X-Spanlens-Delivery-Id']).toBe(d.id)
  })

  test('5xx responses retry after 1, 2, 4 and 8 minutes, then dead-letter', async () => {
    respondWith(503)
    const hook = addHook()
    const first = await dispatchWebhookEvent(hook, 'request.created', {})
    const id = first.deliveryId
    expect(row(id).next_retry_at).toBe(iso(T0 + 1 * MINUTE))

    const expectedWaits = [2, 4, 8]
    for (const [i, wait] of expectedWaits.entries()) {
      const dueAt = Date.parse(row(id).next_retry_at!)
      vi.setSystemTime(dueAt)
      await retryFailedWebhooks()
      expect(row(id)).toMatchObject({
        attempt_count: i + 2,
        next_retry_at: iso(dueAt + wait * MINUTE),
        claimed_until: null,
        claim_token: null,
        dlq_at: null,
      })
    }

    vi.setSystemTime(Date.parse(row(id).next_retry_at!))
    const last = await retryFailedWebhooks()
    expect(last).toMatchObject({ failed: 1, exhausted: 1 })
    expect(row(id)).toMatchObject({
      attempt_count: 5,
      next_retry_at: null,
      dlq_reason: 'exhausted',
      claimed_until: null,
    })
    expect(row(id).dlq_at).not.toBeNull()
    expect(sendMock).toHaveBeenCalledTimes(5)

    // Nothing left to claim.
    vi.setSystemTime(T0 + 24 * 60 * MINUTE)
    expect((await retryFailedWebhooks()).retried).toBe(0)
  })

  test('a successful retry closes the delivery and releases the lease', async () => {
    const d = addDelivery(addHook(), { attempt_count: 2 })

    const result = await retryFailedWebhooks()

    expect(result).toMatchObject({ retried: 1, succeeded: 1, failed: 0 })
    expect(row(d.id)).toMatchObject({
      status: 'success',
      http_status: 200,
      error_message: null,
      attempt_count: 3,
      next_retry_at: null,
      claimed_until: null,
      claim_token: null,
    })
  })

  test('the result write only lands while this run still holds the claim', async () => {
    const d = addDelivery(addHook())
    const takeover = randomUUID()
    sendMock.mockImplementation(async () => {
      // The lease lapsed mid-send and another run claimed the row.
      db.deliveries.set(d.id, { ...row(d.id), claim_token: takeover, attempt_count: 3 })
      await tick()
      return { status: 200, error: null }
    })

    await retryFailedWebhooks()

    expect(row(d.id)).toMatchObject({ status: 'failed', claim_token: takeover, attempt_count: 3 })
  })

  test('a failed result write is logged and does not abort the rest of the batch', async () => {
    const hook = addHook()
    addDelivery(hook)
    addDelivery(hook)
    injected.update = { message: 'write failed' }

    const result = await retryFailedWebhooks()

    expect(result.retried).toBe(2)
    expect(sendMock).toHaveBeenCalledTimes(2)
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('WEBHOOK_DISPATCH_FAILED'))
  })
})

describe('retryFailedWebhooks — counters (C12.3)', () => {
  test('exhausted counts only the rows that failed their last attempt', async () => {
    const hook = addHook()
    const disabled = addHook({ is_active: false })
    const ok = addDelivery(hook, { attempt_count: 4 })
    const bad = addDelivery(hook, { attempt_count: 4 })
    const orphan = addDelivery(disabled, { attempt_count: 4 })
    sendMock.mockImplementation(async (_url, opts) => {
      await tick()
      const id = opts.headers['X-Spanlens-Delivery-Id']
      return id === ok.id ? { status: 200, error: null } : { status: 500, error: null }
    })

    const result = await retryFailedWebhooks()

    expect(result).toMatchObject({ retried: 3, succeeded: 1, failed: 1, exhausted: 1, skipped: 1 })
    expect(row(bad.id).dlq_reason).toBe('exhausted')
    expect(row(ok.id).dlq_reason).toBeNull()
    expect(row(orphan.id).dlq_reason).toBe('webhook_deleted')
  })

  test('a disabled webhook or a missing payload is dead-lettered without a send', async () => {
    const disabled = addDelivery(addHook({ is_active: false }))
    const noPayload = addDelivery(addHook(), { payload: null })

    const result = await retryFailedWebhooks()

    expect(sendMock).not.toHaveBeenCalled()
    expect(result).toMatchObject({ retried: 2, skipped: 2, failed: 0, exhausted: 0 })
    expect(row(disabled.id)).toMatchObject({
      dlq_reason: 'webhook_deleted',
      next_retry_at: null,
      claimed_until: null,
    })
    expect(row(noPayload.id).dlq_reason).toBe('payload_missing')
  })
})

describe('retryFailedWebhooks — time budget (C12.4)', () => {
  test('never has more than `concurrency` sends in flight', async () => {
    const hook = addHook()
    for (let i = 0; i < 12; i++) addDelivery(hook)
    let inFlight = 0
    let peak = 0
    sendMock.mockImplementation(async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 5))
      inFlight--
      return { status: 200, error: null }
    })

    const result = await retryFailedWebhooks({ concurrency: 5 })

    expect(result.succeeded).toBe(12)
    expect(peak).toBeGreaterThan(1)
    expect(peak).toBeLessThanOrEqual(5)
  })

  test('stops claiming at the deadline and leaves the remaining rows untouched', async () => {
    const hook = addHook()
    const rows = Array.from({ length: 12 }, (_, i) =>
      addDelivery(hook, { next_retry_at: iso(T0 - (20 - i) * MINUTE) }),
    )
    let clock = 0
    sendMock.mockImplementation(async () => {
      clock = 5_000 // every send in the first batch runs long
      await tick()
      return { status: 503, error: null }
    })

    const result = await retryFailedWebhooks({ concurrency: 5, deadlineMs: 1_000, now: () => clock })

    expect(result).toMatchObject({ retried: 5, failed: 5, deadlineReached: true })
    expect(sendMock).toHaveBeenCalledTimes(5)
    for (const r of rows.slice(5)) {
      expect(row(r.id)).toMatchObject({ attempt_count: 1, claimed_until: null, claim_token: null })
    }
  })

  test('caps the number of deliveries claimed in one run', async () => {
    const hook = addHook()
    for (let i = 0; i < 9; i++) addDelivery(hook)

    const result = await retryFailedWebhooks({ concurrency: 5, maxDeliveries: 7 })

    expect(result.retried).toBe(7)
    expect(sendMock).toHaveBeenCalledTimes(7)
    expect(rpcMock.mock.calls.map(([, args]) => args['p_limit'])).toEqual([5, 2])
  })
})
