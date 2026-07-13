import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../middleware/authJwt.js'
import { supabaseAdmin } from '../lib/db.js'
import { detectAnomalies } from '../lib/anomaly.js'
import { requestsScope, selectRequests, streamRequests } from '../lib/requests-query.js'
import { fromClickhouseTimestamp } from '../lib/clickhouse.js'
import { ApiError } from '../lib/errors.js'

export const exportsRouter = new Hono<JwtContext>()
exportsRouter.use('*', authJwt)

/**
 * Row cap for the non-streamed `/requests?format=json` endpoint and for the
 * smaller `/traces`, `/security`, `/anomalies` endpoints. These materialise
 * the result in memory before encoding, so the cap prevents OOM.
 */
const MAX_EXPORT_ROWS = 10_000

/**
 * Row cap for the streamed `/requests?format=csv|jsonl` endpoints. The
 * streaming path holds at most one ClickHouse batch (~64KB) in memory at a
 * time, so a much larger cap is safe — enough for a year of Pro-plan data
 * (millions of rows).
 *
 * Picked at 1M because:
 *   - It satisfies P3.11's "100만 row export < 100MB" success criterion with
 *     an order-of-magnitude headroom.
 *   - It exceeds the 365-day retention × typical Team-plan volume.
 *   - It keeps query time bounded under Vercel's 300s function deadline even
 *     when filters are unselective.
 *
 * Multi-GB exports beyond this cap belong on the deferred "S3 presigned URL +
 * email" path (P3.11 follow-up, when first user hits the cap).
 */
const MAX_EXPORT_ROWS_STREAM = 1_000_000

const EXPORT_COLUMNS = [
  'id', 'project_id', 'provider', 'model',
  'prompt_tokens', 'completion_tokens', 'total_tokens',
  'cost_usd', 'latency_ms', 'status_code',
  'error_message', 'trace_id', 'created_at',
] as const

type ExportColumn = (typeof EXPORT_COLUMNS)[number]
type ExportRow = Record<ExportColumn, unknown>

/**
 * Numeric ClickHouse columns come back over JSONEachRow as strings (Decimal /
 * UInt → string, gotcha #19). Coerce them to real numbers at the export
 * boundary so downstream tooling (pandas, BigQuery) receives numbers, not
 * strings like "0.00012345". `null` is preserved (cost can be unknown). CSV is
 * unaffected — String(number) and String(numeric-string) render identically.
 */
const NUMERIC_EXPORT_COLUMNS: readonly ExportColumn[] = [
  'prompt_tokens', 'completion_tokens', 'total_tokens',
  'cost_usd', 'latency_ms', 'status_code',
]

function coerceNumericColumns<Row extends Record<string, unknown>>(row: Row): Row {
  const out: Record<string, unknown> = { ...row }
  for (const col of NUMERIC_EXPORT_COLUMNS) {
    const v = out[col]
    if (v !== null && v !== undefined && v !== '') out[col] = Number(v)
  }
  return out as Row
}

/**
 * Leading characters Excel / Google Sheets interpret as a formula trigger
 * (`=SUM(...)`, `+cmd|...`, `@HYPERLINK(...)`), including the tab / CR
 * variants some spreadsheet importers also honour. Exported cells such as
 * `error_message` carry end-user-controlled LLM text, so an attacker can plant
 * `=HYPERLINK(...)` in a prompt and have it execute when the victim opens the
 * export. OWASP mitigation: prefix the cell with a single quote so the
 * spreadsheet renders it as literal text.
 */
const CSV_FORMULA_TRIGGER = /^[=+\-@\t\r]/

function escapeCsv(val: unknown): string {
  if (val === null || val === undefined) return ''
  let s = String(val)
  // Formula-injection guard — string cells only. Numeric columns are coerced
  // to real numbers before reaching this encoder (coerceNumericColumns), so
  // legitimate negative numbers are `typeof 'number'` and stay untouched.
  if (typeof val === 'string' && CSV_FORMULA_TRIGGER.test(s)) {
    s = "'" + s
  }
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"'
  }
  return s
}

/** Three supported export formats. `csv` and `jsonl` stream; `json` materialises. */
type ExportFormat = 'csv' | 'json' | 'jsonl'

function parseFormat(raw: string | undefined): ExportFormat {
  if (raw === 'json') return 'json'
  if (raw === 'jsonl') return 'jsonl'
  return 'csv'
}

/**
 * Wrap a row stream so each row's `created_at` (ClickHouse's
 * `'YYYY-MM-DD HH:MM:SS.fff'`) is converted to canonical ISO UTC
 * (`'YYYY-MM-DD​T​HH:MM:SS.fff​Z'`) — same fix as the non-streaming endpoints
 * applied to streaming exports.
 *
 * Returns an async generator so backpressure and `for-await` early-exit
 * cancellation propagate through to the underlying ClickHouse driver stream.
 * Rows without a string `created_at` are yielded unchanged.
 *
 * Exported for unit tests; otherwise only used by the `/exports/requests`
 * streaming path below.
 */
export async function* withIsoCreatedAt<Row extends Record<string, unknown>>(
  rows: AsyncIterable<Row>,
): AsyncGenerator<Row, void, undefined> {
  for await (const row of rows) {
    // Coerce ClickHouse string-encoded numerics (cost_usd, tokens, etc.) to
    // numbers so JSONL consumers get numbers, not strings (gotcha #19). CSV is
    // unaffected. Then normalise created_at to ISO UTC.
    const coerced = coerceNumericColumns(row)
    const raw = coerced['created_at']
    if (typeof raw === 'string') {
      yield { ...coerced, created_at: fromClickhouseTimestamp(raw) ?? raw }
    } else {
      yield coerced
    }
  }
}

/**
 * Builds a streaming CSV response (header row + one line per source row).
 *
 * The async iterable is consumed lazily inside the ReadableStream `start`
 * callback — no buffering. Each ClickHouse batch is enqueued as a single
 * Uint8Array chunk; the Node response handler in `api/index.ts` writes each
 * chunk to the socket with backpressure handling.
 */
export function buildCsvStream<Row extends Record<string, unknown>>(
  cols: readonly string[],
  rows: AsyncIterable<Row>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(cols.join(',') + '\n'))
        for await (const row of rows) {
          const line = cols.map((col) => escapeCsv(row[col])).join(',') + '\n'
          controller.enqueue(encoder.encode(line))
        }
        controller.close()
      } catch (err) {
        controller.error(err)
      }
    },
  })
}

/**
 * Builds a streaming JSONL response (one JSON object per line, newline-
 * delimited). This is the recommended format for very large exports — it
 * preserves typing better than CSV and round-trips cleanly through `jq`,
 * `pandas.read_json(lines=True)`, BigQuery, ClickHouse, etc.
 */
export function buildJsonlStream<Row>(rows: AsyncIterable<Row>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const row of rows) {
          controller.enqueue(encoder.encode(JSON.stringify(row) + '\n'))
        }
        controller.close()
      } catch (err) {
        controller.error(err)
      }
    },
  })
}

// GET /api/v1/exports/requests
// Query: format (csv|json|jsonl), projectId, provider, model, providerKeyId,
//        status (ok|4xx|5xx), from, to, limit
//
// Memory profile:
//   - csv / jsonl: streamed. At most one ClickHouse batch (~64KB) in memory.
//                  Row cap: 1M (MAX_EXPORT_ROWS_STREAM).
//   - json:        materialised wrapper object. Row cap: 10k (MAX_EXPORT_ROWS).
//                  Use jsonl for larger JSON exports.
exportsRouter.get('/requests', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  const format        = parseFormat(c.req.query('format'))
  const projectId     = c.req.query('projectId')
  const provider      = c.req.query('provider')
  const model         = c.req.query('model')
  const providerKeyId = c.req.query('providerKeyId')
  const status        = c.req.query('status')   // 'ok' | '4xx' | '5xx'
  const from          = c.req.query('from')
  const to            = c.req.query('to')

  // Cap depends on format — streamed formats allow much larger exports.
  const maxRows = format === 'json' ? MAX_EXPORT_ROWS : MAX_EXPORT_ROWS_STREAM
  const rawLimit = parseInt(c.req.query('limit') ?? String(maxRows), 10)
  const limit    = Math.min(maxRows, Math.max(1, isNaN(rawLimit) ? maxRows : rawLimit))

  const filters: string[] = []
  const params: Record<string, unknown> = {}
  if (projectId)     { filters.push('project_id = {projectId:UUID}'); params['projectId'] = projectId }
  if (provider)      { filters.push('provider = {provider:String}'); params['provider'] = provider }
  if (model)         { filters.push('positionCaseInsensitive(model, {model:String}) > 0'); params['model'] = model }
  if (providerKeyId) { filters.push('provider_key_id = {providerKeyId:UUID}'); params['providerKeyId'] = providerKeyId }
  if (from)          { filters.push('created_at >= parseDateTime64BestEffort({from:String})'); params['from'] = from }
  if (to)            { filters.push('created_at <= parseDateTime64BestEffort({to:String})'); params['to'] = to }
  if (status === 'ok')  filters.push('status_code < 400')
  if (status === '4xx') filters.push('status_code >= 400 AND status_code < 500')
  if (status === '5xx') filters.push('status_code >= 500')

  const filterSql = filters.length > 0 ? filters.join(' AND ') : undefined
  const dateStr = new Date().toISOString().slice(0, 10)

  let scope: Awaited<ReturnType<typeof requestsScope>>
  try {
    scope = await requestsScope(orgId)
  } catch (err) {
    console.error('[exports:requests] scope lookup failed:', err instanceof Error ? err.message : err)
    throw new ApiError('INTERNAL_ERROR', 'Failed to export requests')
  }

  // ── JSON: legacy wrapped format. Materialised, capped at 10k. ────────────────
  if (format === 'json') {
    let rows: ExportRow[]
    try {
      rows = await selectRequests<ExportRow>({
        scope,
        select: EXPORT_COLUMNS.join(', '),
        filters: filterSql,
        orderBy: 'created_at DESC',
        limit,
        params,
      })
    } catch (err) {
      console.error('[exports:requests] ClickHouse query failed:', err instanceof Error ? err.message : err)
      throw new ApiError('INTERNAL_ERROR', 'Failed to export requests')
    }
    // ClickHouse DateTime64 → ISO UTC (gotcha #18) + string-encoded numerics
    // → numbers (gotcha #19) so pandas/BigQuery receive numbers, not strings.
    const normalised = rows.map((r) => {
      const coerced = coerceNumericColumns(r)
      return {
        ...coerced,
        created_at: fromClickhouseTimestamp(typeof coerced.created_at === 'string' ? coerced.created_at : null) ?? coerced.created_at,
      }
    })
    const body = JSON.stringify(
      { exported_at: new Date().toISOString(), count: normalised.length, data: normalised },
      null,
      2,
    )
    return new Response(body, {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="spanlens-requests-${dateStr}.json"`,
      },
    })
  }

  // ── Streaming path: CSV or JSONL. ────────────────────────────────────────────
  //
  // `streamRequests` is an async generator backed by the ClickHouse driver's
  // batched Readable stream — peak memory is one batch (~64KB), independent
  // of `limit`. The `buildCsvStream` / `buildJsonlStream` helpers transform
  // rows on-the-fly inside the ReadableStream `start` callback, so backpressure
  // propagates from the Node socket → Web stream controller → CH driver.
  const rawRowsIter = streamRequests<ExportRow>({
    scope,
    select: EXPORT_COLUMNS.join(', '),
    filters: filterSql,
    orderBy: 'created_at DESC',
    limit,
    params,
  })

  // Transform `created_at` from ClickHouse's 'YYYY-MM-DD HH:MM:SS.fff' format
  // (no T, no Z) into canonical ISO UTC. The non-streaming JSON path already
  // does this — the streaming CSV/JSONL paths were missed in PR #130 because
  // the row iterator is consumed inline by the stream builders. Wrapping with
  // `withIsoCreatedAt` preserves backpressure and CH driver cancellation by
  // re-yielding each row from the original iterator.
  const rowsIter = withIsoCreatedAt(rawRowsIter)

  if (format === 'jsonl') {
    return new Response(buildJsonlStream(rowsIter), {
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Content-Disposition': `attachment; filename="spanlens-requests-${dateStr}.jsonl"`,
        'Cache-Control': 'no-store',
      },
    })
  }

  // CSV (default)
  return new Response(buildCsvStream(EXPORT_COLUMNS, rowsIter), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="spanlens-requests-${dateStr}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
})

// ── helpers ───────────────────────────────────────────────────────────────────

function jsonResponse(data: unknown, filename: string): Response {
  return new Response(
    JSON.stringify({ exported_at: new Date().toISOString(), count: Array.isArray(data) ? data.length : 0, data }, null, 2),
    { headers: { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="${filename}"` } },
  )
}

function csvResponse(cols: readonly string[], rows: Record<string, unknown>[], filename: string): Response {
  const lines = [
    cols.join(','),
    ...rows.map((r) => cols.map((c) => escapeCsv(r[c])).join(',')),
  ]
  return new Response(lines.join('\n'), {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"` },
  })
}

// ── GET /api/v1/exports/traces ─────────────────────────────────────────────────
// Query: format, status (completed|error|running), from, to, limit

const TRACE_COLS = [
  'id', 'project_id', 'name', 'status', 'error_message',
  'duration_ms', 'total_cost_usd', 'total_tokens', 'span_count',
  'started_at', 'ended_at', 'created_at',
] as const

exportsRouter.get('/traces', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  const format  = c.req.query('format') === 'json' ? 'json' : 'csv'
  const status  = c.req.query('status')
  const from    = c.req.query('from')
  const to      = c.req.query('to')
  const rawLimit = parseInt(c.req.query('limit') ?? String(MAX_EXPORT_ROWS), 10)
  const limit   = Math.min(MAX_EXPORT_ROWS, Math.max(1, isNaN(rawLimit) ? MAX_EXPORT_ROWS : rawLimit))

  let query = supabaseAdmin
    .from('traces')
    .select([...TRACE_COLS].join(', '))
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (status && status !== 'all') query = query.eq('status', status)
  if (from) query = query.gte('created_at', from)
  if (to)   query = query.lte('created_at', to)

  const { data, error } = await query
  if (error) throw new ApiError('INTERNAL_ERROR', 'Failed to export traces')

  const rows = (data ?? []) as unknown as Record<string, unknown>[]
  const dateStr = new Date().toISOString().slice(0, 10)

  return format === 'json'
    ? jsonResponse(rows, `spanlens-traces-${dateStr}.json`)
    : csvResponse([...TRACE_COLS], rows, `spanlens-traces-${dateStr}.csv`)
})

// ── GET /api/v1/exports/anomalies ──────────────────────────────────────────────
// Query: format, projectId — exports current live anomaly detection result

const ANOMALY_COLS = [
  'provider', 'model', 'kind',
  'current_value', 'baseline_mean', 'baseline_stddev', 'deviations',
  'sample_count', 'reference_count',
]

exportsRouter.get('/anomalies', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  const format = c.req.query('format') === 'json' ? 'json' : 'csv'
  const projectId = c.req.query('projectId')

  if (projectId) {
    const { data: proj } = await supabaseAdmin
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('organization_id', orgId)
      .single()
    if (!proj) throw new ApiError('NOT_FOUND', 'Project not found')
  }

  const anomalies = await detectAnomalies(orgId, {
    observationHours: 1,
    referenceHours: 24 * 7,
    sigmaThreshold: 3,
    ...(projectId ? { projectId } : {}),
  })

  const rows: Record<string, unknown>[] = anomalies.map((a) => ({
    provider:         a.provider,
    model:            a.model,
    kind:             a.kind,
    current_value:    a.currentValue,
    baseline_mean:    a.baselineMean,
    baseline_stddev:  a.baselineStdDev,
    deviations:       a.deviations,
    sample_count:     a.sampleCount,
    reference_count:  a.referenceCount,
  }))

  const dateStr = new Date().toISOString().slice(0, 10)

  return format === 'json'
    ? jsonResponse(rows, `spanlens-anomalies-${dateStr}.json`)
    : csvResponse(ANOMALY_COLS, rows, `spanlens-anomalies-${dateStr}.csv`)
})

// ── GET /api/v1/exports/security ───────────────────────────────────────────────
// Query: format — exports flagged requests (PII / prompt injection)

const SECURITY_COLS = [
  'id', 'provider', 'model', 'status_code', 'latency_ms', 'cost_usd', 'flags', 'created_at',
]

exportsRouter.get('/security', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  const format = c.req.query('format') === 'json' ? 'json' : 'csv'

  let data: Array<{
    id: string
    provider: string
    model: string
    status_code: number
    latency_ms: number
    cost_usd: string | null
    flags: string
    created_at: string
  }>
  try {
    const scope = await requestsScope(orgId)
    data = await selectRequests({
      scope,
      select: 'id, provider, model, status_code, latency_ms, cost_usd, flags, created_at',
      // has_security_flags is the boolean derived from flags+response_flags at
      // insert time, indexed-friendly. Filtering on it beats string-comparing
      // the JSON-encoded `flags` column.
      filters: 'has_security_flags = 1',
      orderBy: 'created_at DESC',
      limit: MAX_EXPORT_ROWS,
    })
  } catch (err) {
    console.error('[exports:security] ClickHouse query failed:', err instanceof Error ? err.message : err)
    throw new ApiError('INTERNAL_ERROR', 'Failed to export security events')
  }

  // CSV gets the flags column as a string literal; JSON parses it back to an array.
  // Both formats get a canonical ISO UTC `created_at` (with `Z` suffix) so
  // downstream consumers don't have to guess the timezone of ClickHouse's
  // 'YYYY-MM-DD HH:MM:SS.fff' format. Excel still parses ISO datetime fine.
  // JSON additionally coerces ClickHouse string-encoded numerics (cost_usd,
  // latency_ms, status_code) to numbers — gotcha #19, same treatment as the
  // /exports/requests JSON path — so pandas/BigQuery get numeric columns.
  const rows: Record<string, unknown>[] = data.map((row) => {
    const isoCreated = fromClickhouseTimestamp(row.created_at) ?? row.created_at
    // CSV also coerces ClickHouse string-encoded numerics so the formula-
    // injection guard in escapeCsv (string cells only) can never prefix a
    // legitimate negative number rendered as a numeric string.
    if (format === 'csv') return { ...coerceNumericColumns(row), created_at: isoCreated }
    let parsedFlags: unknown = []
    try { parsedFlags = JSON.parse(row.flags) } catch { parsedFlags = row.flags }
    return { ...coerceNumericColumns(row), flags: parsedFlags, created_at: isoCreated }
  })

  const dateStr = new Date().toISOString().slice(0, 10)

  return format === 'json'
    ? jsonResponse(rows, `spanlens-security-${dateStr}.json`)
    : csvResponse(SECURITY_COLS, rows, `spanlens-security-${dateStr}.csv`)
})
