/**
 * /cron/aggregate-usage — daily `requests` → `usage_daily` rollup.
 *
 * Extracted from api/cron.ts during the 1053-line file split. The cron
 * route in api/cron.ts now just calls runAggregateUsageJob and lets the
 * router serialise the result; everything else (the rollup statement and
 * the today/yesterday window) lives here.
 *
 * Why today AND yesterday: a request created at 23:59 UTC may only get
 * aggregated after midnight UTC. The first run of the new day finalises
 * yesterday's totals before today's first rollup overwrites the cached
 * view. Re-running the same day is a no-op thanks to the UNIQUE constraint
 * on (organization_id, project_id, date, provider, model).
 *
 * `requests` and `usage_daily` live in the same database, so the rollup is a
 * single `INSERT … SELECT … ON CONFLICT DO UPDATE`. Keep it that way: reading
 * the groups out, coercing them in JS and shipping them back as an upsert
 * payload costs a full round trip of the entire result set and makes the day
 * non-atomic, so a crash midway leaves half a day upserted.
 *
 * The statement is unscoped (no per-org filter) because aggregate-usage is
 * operator-internal: the whole point is a cross-tenant rollup. Running as
 * the pooled application role (which bypasses RLS, as service-role always
 * did) is correct here.
 */

// no-restricted-imports rule is scoped to api/ handlers (the worry is
// tenant-blind reads from request handlers). lib/cron-jobs/ is operator-
// internal cron territory, so the lint rule doesn't fire here.
import { pgExecute } from '../postgres.js'
import { anyActivitySince } from '../org-activity.js'
import { lastSuccessfulRunAt } from '../cron-cadence.js'

export interface AggregateUsageDayResult {
  date: string
  rows: number | null
  error?: string
}

export interface AggregateUsageJobResult {
  success: boolean
  ran_at: string
  results: AggregateUsageDayResult[]
  /** Set when the activity watermark showed nothing new to roll up. */
  skipped?: 'no_new_activity'
}

/**
 * `date` is always a `YYYY-MM-DD` string this module derived from `Date`,
 * never caller input, but it still goes through a bound parameter rather
 * than the SQL text, because the rule has no exceptions.
 *
 * Window: `[day, day + 1 day)`, evaluated in UTC because lib/postgres.ts
 * pins the session timezone. Half-open on purpose. Closing it against
 * `23:59:59.999` would drop every row in the last millisecond of the day,
 * because `created_at` has microsecond resolution.
 */
async function aggregateOneDay(date: string): Promise<AggregateUsageDayResult> {
  try {
    const rows = await pgExecute({
      query: `
        INSERT INTO usage_daily (
          organization_id, project_id, date, provider, model,
          request_count, prompt_tokens, completion_tokens, total_tokens, cost_usd
        )
        SELECT
          organization_id,
          project_id,
          {day}::date AS date,
          provider,
          model,
          count(*) AS request_count,
          COALESCE(sum(prompt_tokens), 0) AS prompt_tokens,
          COALESCE(sum(completion_tokens), 0) AS completion_tokens,
          COALESCE(sum(total_tokens), 0) AS total_tokens,
          COALESCE(sum(cost_usd), 0) AS cost_usd
        FROM requests
        WHERE created_at >= {day}::date
          AND created_at <  ({day}::date + INTERVAL '1 day')
          AND status_code < 400
          AND model <> ''
        GROUP BY organization_id, project_id, provider, model
        ON CONFLICT (organization_id, project_id, date, provider, model)
        DO UPDATE SET
          request_count     = EXCLUDED.request_count,
          prompt_tokens     = EXCLUDED.prompt_tokens,
          completion_tokens = EXCLUDED.completion_tokens,
          total_tokens      = EXCLUDED.total_tokens,
          cost_usd          = EXCLUDED.cost_usd,
          updated_at        = now()
      `,
      params: { day: date },
    })
    return { date, rows }
  } catch (err) {
    return { date, rows: null, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function runAggregateUsageJob(
  options: { force?: boolean } = {},
): Promise<AggregateUsageJobResult> {
  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  // The rollup is a pure function of the `requests` rows it reads, so if no
  // request has been logged since the last successful run there is nothing to
  // recompute. Both lookups fail open, so an unreadable watermark or missing
  // run history still aggregates. `force` is the operator escape hatch for
  // re-running after usage_daily rows are edited or deleted by hand.
  if (!options.force) {
    const lastRun = await lastSuccessfulRunAt('aggregate-usage')
    if (lastRun && !(await anyActivitySince(lastRun))) {
      return { success: true, ran_at: now.toISOString(), skipped: 'no_new_activity', results: [] }
    }
  }

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
