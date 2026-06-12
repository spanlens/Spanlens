/**
 * /cron/aggregate-usage — daily `requests` → `usage_daily` rollup.
 *
 * Extracted from api/cron.ts during the 1053-line file split. The cron
 * route in api/cron.ts now just calls runAggregateUsageJob and lets the
 * router serialise the result; everything else (CH query, Postgres
 * upsert, today/yesterday window) lives here.
 *
 * Why today AND yesterday: a request created at 23:59 UTC may only get
 * aggregated after midnight UTC. The first run of the new day finalises
 * yesterday's totals before today's first rollup overwrites the cached
 * view. Re-running the same day is a no-op thanks to the UNIQUE constraint
 * on (organization_id, project_id, date, provider, model).
 *
 * The CH query is unscoped (no per-org filter) because aggregate-usage
 * is operator-internal: the whole point is a cross-tenant rollup. RLS
 * bypass via service-role is correct here.
 */

// eslint-disable-next-line no-restricted-imports
import { unscopedClickhouse } from '../clickhouse.js'
import { supabaseAdmin } from '../db.js'

export interface AggregateUsageDayResult {
  date: string
  rows: number | null
  error?: string
}

export interface AggregateUsageJobResult {
  success: boolean
  ran_at: string
  results: AggregateUsageDayResult[]
}

async function aggregateOneDay(date: string): Promise<AggregateUsageDayResult> {
  try {
    // ClickHouse aggregates the full day in-DB. No per-tenant scope helper
    // because the cron is cross-tenant by design.
    const sql = `
      SELECT
        organization_id,
        project_id,
        provider,
        model,
        count() AS request_count,
        sum(prompt_tokens) AS prompt_tokens,
        sum(completion_tokens) AS completion_tokens,
        sum(total_tokens) AS total_tokens,
        sum(cost_usd) AS cost_usd
      FROM requests
      WHERE created_at >= parseDateTime64BestEffort({dayStart:String})
        AND created_at <  parseDateTime64BestEffort({dayEnd:String})
        AND status_code < 400
        AND model != ''
      GROUP BY organization_id, project_id, provider, model
    `
    const dayStart = `${date} 00:00:00.000`
    const dayEnd = `${date} 23:59:59.999`
    const ch = unscopedClickhouse()
    const queryResult = await ch.query({
      query: sql,
      query_params: { dayStart, dayEnd },
      format: 'JSONEachRow',
    })
    const rows = (await queryResult.json()) as Array<{
      organization_id: string
      project_id: string
      provider: string
      model: string
      request_count: string | number
      prompt_tokens: string | number
      completion_tokens: string | number
      total_tokens: string | number
      cost_usd: string | number
    }>

    if (rows.length === 0) return { date, rows: 0 }

    // gotcha #19: ClickHouse JSONEachRow returns numbers as strings, so
    // wrap each numeric in Number() before writing to Postgres.
    const upserts = rows.map((r) => ({
      organization_id: r.organization_id,
      project_id: r.project_id,
      date,
      provider: r.provider,
      model: r.model,
      request_count: Number(r.request_count ?? 0),
      prompt_tokens: Number(r.prompt_tokens ?? 0),
      completion_tokens: Number(r.completion_tokens ?? 0),
      total_tokens: Number(r.total_tokens ?? 0),
      cost_usd: Number(r.cost_usd ?? 0),
      updated_at: new Date().toISOString(),
    }))
    const { error: upsertError } = await supabaseAdmin
      .from('usage_daily')
      .upsert(upserts, {
        onConflict: 'organization_id,project_id,date,provider,model',
      })
    if (upsertError) return { date, rows: null, error: upsertError.message }
    return { date, rows: upserts.length }
  } catch (err) {
    return { date, rows: null, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function runAggregateUsageJob(): Promise<AggregateUsageJobResult> {
  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const results: AggregateUsageDayResult[] = []
  for (const date of [yesterday, today]) {
    results.push(await aggregateOneDay(date))
  }

  return {
    success: results.every((r) => !r.error),
    ran_at: now.toISOString(),
    results,
  }
}
