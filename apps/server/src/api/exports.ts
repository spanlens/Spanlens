import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../middleware/authJwt.js'
import { supabaseAdmin } from '../lib/db.js'
import { detectAnomalies } from '../lib/anomaly.js'
import { requestsScope, selectRequests, streamRequests } from '../lib/requests-query.js'
import { encodeRowStream, type RowStreamOptions } from '../lib/export-stream.js'
import { parseRequestFilters } from '../lib/request-filters.js'
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
 * streaming path reads the cursor only as fast as the client downloads, so
 * memory stays bounded by the encoder's queue (lib/export-stream.ts) plus one
 * cursor batch whatever the cap, and a much larger cap is safe.
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

/**
 * Column order is the CSV header order, and the header is a contract: scripts
 * index into it. New columns go at the end. `user_id` / `session_id` /
 * `prompt_version_id` were appended so an export filtered on them can be
 * checked (and re-split) after the fact.
 */
const EXPORT_COLUMNS = [
  'id', 'project_id', 'provider', 'model',
  'prompt_tokens', 'completion_tokens', 'total_tokens',
  'cost_usd', 'latency_ms', 'status_code',
  'error_message', 'trace_id', 'created_at',
  'user_id', 'session_id', 'prompt_version_id',
] as const

type ExportColumn = (typeof EXPORT_COLUMNS)[number]
type ExportRow = Record<ExportColumn, unknown>

/**
 * `numeric` and `int8` columns arrive from the driver as strings, deliberately:
 * neither fits in a JS number without risking precision loss (see
 * lib/postgres.ts). Coerce them to real numbers at the export boundary so
 * downstream tooling (pandas, BigQuery) receives numbers, not strings like
 * "0.00012345". `null` is preserved (cost can be unknown). CSV is unaffected —
 * String(number) and String(numeric-string) render identically.
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
 * Wrap a row stream so each row's string-encoded numerics (`cost_usd`, token
 * counts, …) become real numbers before encoding.
 *
 * Named for what it used to do as well: rewrite `created_at`. That rewrite is
 * gone — see the comment in the loop below.
 *
 * Returns an async generator so backpressure and `for-await` early-exit
 * cancellation propagate through to the underlying cursor.
 *
 * Exported for unit tests; otherwise only used by the `/exports/requests`
 * streaming path below.
 */
export async function* withIsoCreatedAt<Row extends Record<string, unknown>>(
  rows: AsyncIterable<Row>,
): AsyncGenerator<Row, void, undefined> {
  for await (const row of rows) {
    // Coerce string-encoded numerics (cost_usd, tokens, etc.) so JSONL
    // consumers get numbers, not strings. CSV is unaffected.
    //
    // `created_at` is deliberately left alone: the driver's timestamptz parser
    // (lib/postgres.ts) already returns canonical ISO UTC, so any reformatting
    // here can only corrupt a value that is already in the shape every
    // consumer expects.
    yield coerceNumericColumns(row)
  }
}

/**
 * Builds a streaming CSV response (header row + one line per source row).
 *
 * Rows are pulled from the source only as fast as the consumer reads, and
 * cancelling the stream releases the source (lib/export-stream.ts has the
 * why). `options` exists for tests; the route uses the defaults.
 */
export function buildCsvStream<Row extends Record<string, unknown>>(
  cols: readonly string[],
  rows: AsyncIterable<Row>,
  options: RowStreamOptions = {},
): ReadableStream<Uint8Array> {
  return encodeRowStream(
    rows,
    (row) => cols.map((col) => escapeCsv(row[col])).join(',') + '\n',
    { ...options, preamble: cols.join(',') + '\n' },
  )
}

/**
 * Builds a streaming JSONL response (one JSON object per line, newline-
 * delimited). This is the recommended format for very large exports — it
 * preserves typing better than CSV and round-trips cleanly through `jq`,
 * `pandas.read_json(lines=True)`, BigQuery, ClickHouse, etc.
 */
export function buildJsonlStream<Row>(
  rows: AsyncIterable<Row>,
  options: RowStreamOptions = {},
): ReadableStream<Uint8Array> {
  return encodeRowStream(rows, (row) => JSON.stringify(row) + '\n', options)
}

/**
 * Reads the first row before the response is committed, and hands back an
 * iterator that replays it and then continues from the source.
 *
 * A streamed export answers 200 the moment the Response is returned, so
 * anything that fails afterwards can only abort the connection. The common
 * failures (connection checkout, the query itself, a statement timeout on the
 * first batch) all happen before the first row arrives, so waiting for that
 * row turns them into a proper 500.
 *
 * Deliberately a plain iterator object, not an async generator: `return()` on
 * a generator that has not started yet skips its body, so a wrapper generator
 * cancelled before its first read would never forward `return()`, and the
 * cursor this function has already opened would keep its pooled connection.
 */
async function primeRows<Row>(rows: AsyncIterable<Row>): Promise<AsyncIterableIterator<Row>> {
  const source = rows[Symbol.asyncIterator]()
  let pending: IteratorResult<Row, unknown> | null = await source.next()
  const primed: AsyncIterableIterator<Row> = {
    async next() {
      if (pending !== null) {
        const first = pending
        pending = null
        if (first.done) return { done: true, value: undefined }
        return first
      }
      return source.next()
    },
    async return() {
      pending = null
      await source.return?.()
      return { done: true, value: undefined }
    },
    [Symbol.asyncIterator]() {
      return primed
    },
  }
  return primed
}

// GET /api/v1/exports/requests
// Query: format (csv|json|jsonl), limit, plus the list endpoint's filters:
//        projectId, provider, model, providerKeyId, promptVersionId, userId,
//        sessionId, status (ok|success|4xx|5xx|error|all),
//        truncated (true|false|all), from, to.
//
// Malformed filters are a 400 before any query runs (parseRequestFilters),
// which matters most on the streamed formats: once their 200 is out, a failure
// can only abort the connection.
//
// Memory profile:
//   - csv / jsonl: streamed with backpressure. The cursor is read only as fast
//                  as the client downloads (lib/export-stream.ts), so memory is
//                  one queue of encoded output plus one cursor batch.
//                  Row cap: 1M (MAX_EXPORT_ROWS_STREAM).
//   - json:        materialised wrapper object. Row cap: 10k (MAX_EXPORT_ROWS).
//                  Use jsonl for larger JSON exports.
exportsRouter.get('/requests', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')

  const format = parseFormat(c.req.query('format'))
  // Strict: an unknown status/truncated value would otherwise export every row.
  const { sql: filterSql, params } = parseRequestFilters((name) => c.req.query(name), {
    strictEnums: true,
  })

  // Cap depends on format — streamed formats allow much larger exports.
  const maxRows = format === 'json' ? MAX_EXPORT_ROWS : MAX_EXPORT_ROWS_STREAM
  const rawLimit = parseInt(c.req.query('limit') ?? String(maxRows), 10)
  const limit    = Math.min(maxRows, Math.max(1, isNaN(rawLimit) ? maxRows : rawLimit))

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
      console.error('[exports:requests] query failed:', err instanceof Error ? err.message : err)
      throw new ApiError('INTERNAL_ERROR', 'Failed to export requests')
    }
    // String-encoded numerics → numbers so pandas/BigQuery receive numbers,
    // not strings. `created_at` already arrives as canonical ISO UTC.
    const normalised = rows.map((r) => coerceNumericColumns(r))
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
  // `streamRequests` is an async generator backed by a server-side Postgres
  // cursor. The encoders pull from it only while their queue is below its
  // high-water mark, so backpressure runs from the Node socket (api/index.ts
  // stops calling read()) through the stream to the cursor, and cancelling
  // the body releases the cursor's connection (lib/export-stream.ts).
  const rawRowsIter = streamRequests<ExportRow>({
    scope,
    select: EXPORT_COLUMNS.join(', '),
    filters: filterSql,
    orderBy: 'created_at DESC',
    limit,
    params,
  })

  // Coerce string-encoded numerics on the way out. Wrapping rather than
  // mapping inline preserves backpressure and cursor cancellation, because
  // each row is re-yielded from the original iterator.
  let rowsIter: AsyncIterableIterator<ExportRow>
  try {
    rowsIter = await primeRows(withIsoCreatedAt(rawRowsIter))
  } catch (err) {
    console.error('[exports:requests] stream open failed:', err instanceof Error ? err.message : err)
    throw new ApiError('INTERNAL_ERROR', 'Failed to export requests')
  }

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
    // jsonb column — the driver hands this back already parsed.
    flags: unknown
    created_at: string
  }>
  try {
    const scope = await requestsScope(orgId)
    data = await selectRequests({
      scope,
      select: 'id, provider, model, status_code, latency_ms, cost_usd, flags, created_at',
      // has_security_flags is the boolean derived from flags+response_flags at
      // insert time, and carries a partial index. Filtering on it beats
      // unrolling the `flags` jsonb array.
      filters: 'has_security_flags',
      orderBy: 'created_at DESC',
      limit: MAX_EXPORT_ROWS,
    })
  } catch (err) {
    console.error('[exports:security] query failed:', err instanceof Error ? err.message : err)
    throw new ApiError('INTERNAL_ERROR', 'Failed to export security events')
  }

  // `flags` is jsonb, so the driver already hands back an array. JSON keeps it
  // as one; CSV re-encodes it, because a CSV cell is a string and String() on
  // an array of objects renders "[object Object]".
  //
  // `created_at` needs no conversion — the driver's timestamptz parser returns
  // canonical ISO UTC, with the `Z` suffix Excel parses fine.
  //
  // Both formats coerce string-encoded numerics (cost_usd, latency_ms,
  // status_code) to numbers, so pandas/BigQuery get numeric columns and the
  // formula-injection guard in escapeCsv (string cells only) can never prefix
  // a legitimate negative number rendered as a numeric string.
  const rows: Record<string, unknown>[] = data.map((row) =>
    format === 'csv'
      ? { ...coerceNumericColumns(row), flags: JSON.stringify(row.flags ?? []) }
      : { ...coerceNumericColumns(row), flags: row.flags ?? [] },
  )

  const dateStr = new Date().toISOString().slice(0, 10)

  return format === 'json'
    ? jsonResponse(rows, `spanlens-security-${dateStr}.json`)
    : csvResponse(SECURITY_COLS, rows, `spanlens-security-${dateStr}.csv`)
})
