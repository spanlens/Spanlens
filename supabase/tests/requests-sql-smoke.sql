-- Executes the SQL shapes the `requests` query layer builds, against a real
-- Postgres, so a dialect error fails CI instead of production.
--
-- Why this file exists: every unit test around these queries mocks the
-- database client, which means the SQL string is assembled and then never
-- parsed. That is exactly how the `cache_savings` endpoint shipped returning
-- 500 on every call for weeks (CLAUDE.md gotcha #37) — an aggregate alias
-- shadowed a column, and not one mocked test noticed, because none of them
-- ever sent the statement anywhere.
--
-- The migration from ClickHouse multiplied that risk: ~44 query sites were
-- rewritten into a different dialect at once. So the constructs that are
-- either new, engine-specific, or previously illegal get exercised here.
-- Row counts do not matter. Parsing, planning, and type resolution do.
--
-- Run: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/requests-sql-smoke.sql
-- CI runs it after `supabase db reset`, against the local stack.
--
-- Adding a query to the app? If it uses a construct not already covered
-- below, add it here too. A shape that appears in this file has been proven
-- against Postgres; one that does not has been proven against nothing.

\set ON_ERROR_STOP on

\echo '── requests SQL smoke ──'

BEGIN;

-- The fixture creates its own tenant rather than borrowing whatever happens to
-- be in the database. CI resets with --no-seed, so `organizations` is empty
-- there: a fixture that selected an existing org would insert zero rows, every
-- query below would run against nothing, and the file would still pass while
-- proving far less than it claims. `organizations.owner_id` references
-- `auth.users`, hence the user row.
INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES (
  '00000000-0000-4000-8000-00000000f001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'sql-smoke@spanlens.test'
);

INSERT INTO public.organizations (id, name, owner_id)
VALUES (
  '00000000-0000-4000-8000-00000000f002',
  'sql-smoke',
  '00000000-0000-4000-8000-00000000f001'
);

-- A row to plan against. Rolled back at the end, so the table is untouched.
-- Values are chosen to prove type decisions, not to be realistic:
--   * trace_id holds a non-UUID string. ClickHouse typed this column
--     Nullable(UUID) and silently rejected the entire row when a caller sent
--     anything else, taking the log entry with it (gotcha #34). Text makes
--     that failure mode structurally impossible; this row is the proof.
--   * flags / response_flags are real jsonb, not JSON-encoded strings.
--   * truncated / cache_hit / has_security_flags are real booleans, not 0/1.
INSERT INTO public.requests (
  id, organization_id, project_id, api_key_id, provider, model,
  prompt_tokens, completion_tokens, total_tokens, cache_read_tokens, cache_write_tokens,
  cost_usd, latency_ms, proxy_overhead_ms, status_code,
  request_body, response_body, error_message,
  trace_id, span_id, prompt_version_id, provider_key_id,
  user_id, session_id,
  flags, response_flags, has_security_flags, truncated, cache_hit, service_tier, created_at
)
SELECT
  gen_random_uuid(), o.id, gen_random_uuid(), NULL,
  'openai', 'gpt-4o-mini',
  10, 20, 30, 4, 0,
  0.00012345, 250, 12, 200,
  '{"messages":[]}', '{"choices":[]}', NULL,
  'not-a-uuid-and-that-is-fine', NULL, NULL, NULL,
  'user-1', 'sess-1',
  '[{"type":"pii","pattern":"email"}]'::jsonb, '[]'::jsonb,
  true, false, false, '', now()
FROM public.organizations o
WHERE o.id = '00000000-0000-4000-8000-00000000f002';

\echo '  1/8 ordered-set aggregates with FILTER'
-- percentile_cont is an ordered-set aggregate. Attaching FILTER to one is
-- legal but uncommon enough to be worth proving; seven query sites depend on
-- it. make_interval() is here because Postgres cannot parameterise an
-- interval unit — `INTERVAL $1 DAY` is a syntax error, and the retention clip
-- in requests-query.ts needs the day count bound rather than interpolated.
SELECT
  percentile_cont(0.50) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE latency_ms > 0) AS p50,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE latency_ms > 0) AS p95,
  avg(proxy_overhead_ms) FILTER (WHERE proxy_overhead_ms IS NOT NULL)                    AS avg_overhead,
  stddev_samp(latency_ms) FILTER (WHERE status_code < 400)                               AS latency_sd,
  count(*) FILTER (WHERE status_code >= 400)                                             AS errors,
  sum(cost_usd) FILTER (WHERE cache_hit)                                                 AS cached_cost
FROM public.requests
WHERE created_at >= now() - make_interval(days => 90);

\echo '  2/8 windowed total alongside GROUP BY, with a literal-substring search'
-- count(*) OVER () next to a GROUP BY is how every paginated endpoint gets its
-- total in one round trip. position(lower(x) in lower(y)) rather than ILIKE:
-- the ClickHouse function being replaced matched a literal substring, and
-- ILIKE would treat % and _ in a user's search term as wildcards.
SELECT
  user_id,
  count(*)              AS requests,
  count(DISTINCT model) AS models,
  min(created_at)       AS first_seen,
  count(*) OVER ()      AS total_count
FROM public.requests
WHERE user_id IS NOT NULL
  AND position(lower('user') in lower(user_id)) > 0
GROUP BY user_id
ORDER BY requests DESC NULLS LAST
LIMIT 10;

\echo '  3/8 jsonb array unroll, and an output alias named count'
-- Two things at once. The lateral unroll replaces ClickHouse's ARRAY JOIN over
-- a JSON-encoded string column, now that flags is genuinely jsonb. And the
-- output column is deliberately named `count` and then sorted on — the exact
-- alias-shadowing shape that caused gotcha #37. It is safe here (ORDER BY
-- resolves output names before functions) but "safe" is a claim worth testing.
SELECT
  flag->>'type'    AS flag_type,
  flag->>'pattern' AS pattern,
  count(*)         AS count
FROM public.requests
CROSS JOIN LATERAL jsonb_array_elements(flags) AS flag
WHERE has_security_flags
  AND created_at >= now() - make_interval(hours => 24)
GROUP BY flag->>'type', flag->>'pattern'
ORDER BY count DESC
LIMIT 20;

\echo '  4/8 timeseries buckets with explicit UTC rendering'
-- AT TIME ZONE 'UTC' is load-bearing. to_char on a timestamptz renders in the
-- session timezone, so without it the output would be local wall-clock time
-- while the literal "Z" in the format string claimed otherwise — wrong, and
-- silent. lib/postgres.ts also pins the session to UTC; this is the second
-- layer, so a future connection-config change cannot quietly break it.
SELECT
  to_char(date_trunc('hour', created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS day,
  count(*)                                                         AS requests,
  sum(cost_usd)                                                    AS cost,
  sum(total_tokens)                                                AS tokens,
  count(*) FILTER (WHERE status_code >= 400 AND status_code < 500) AS errors_4xx,
  count(*) FILTER (WHERE status_code >= 500)                       AS errors_5xx,
  count(*) FILTER (WHERE status_code = 429)                        AS errors_429,
  percentile_cont(0.5)  WITHIN GROUP (ORDER BY latency_ms)         AS p50_latency_ms,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)         AS p95_latency_ms
FROM public.requests
WHERE created_at >= now() - make_interval(days => 30)
GROUP BY date_trunc('hour', created_at)
ORDER BY date_trunc('hour', created_at);

\echo '  5/8 UNION ALL breakdown (subquery alias is mandatory in Postgres)'
-- ClickHouse accepts an unaliased subquery in FROM; Postgres does not. The
-- `breakdown` alias is the whole point of this case.
SELECT * FROM (
  SELECT
    to_char(date_trunc('day', created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS day,
    'status'          AS kind,
    status_code::text AS value,
    count(*)          AS n
  FROM public.requests
  GROUP BY date_trunc('day', created_at), status_code::text
  UNION ALL
  SELECT
    to_char(date_trunc('day', created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS day,
    'model'                      AS kind,
    concat(provider, '/', model) AS value,
    count(*)                     AS n
  FROM public.requests
  GROUP BY date_trunc('day', created_at), concat(provider, '/', model)
) breakdown
ORDER BY day, kind, n DESC;

\echo '  6/8 anomaly stats: HAVING moved into an outer WHERE'
-- ClickHouse lets HAVING reference a SELECT alias. Postgres does not, and the
-- alternative to repeating two long conditional aggregates inline is to wrap
-- the aggregate and filter outside it. That rewrite is what this proves.
SELECT * FROM (
  SELECT
    provider, model,
    avg(latency_ms) FILTER (WHERE latency_ms > 0)                     AS obs_latency,
    stddev_samp(latency_ms) FILTER (WHERE latency_ms > 0)             AS obs_latency_sd,
    avg(cost_usd) FILTER (WHERE cost_usd IS NOT NULL)                 AS obs_cost,
    avg(CASE WHEN status_code >= 400 THEN 1.0 ELSE 0.0 END)           AS obs_error_rate,
    count(*) FILTER (WHERE created_at >= now() - interval '1 day')    AS obs_all_count,
    count(*) FILTER (WHERE created_at <  now() - interval '1 day')    AS ref_all_count
  FROM public.requests
  WHERE created_at >= now() - make_interval(days => 14)
  GROUP BY provider, model
) s
WHERE s.obs_all_count > 0 OR s.ref_all_count > 0;

\echo '  7/8 session rollup: aggregate alias shadowing a filtered column'
-- min(user_id) AS user_id while the WHERE filters the real user_id column.
-- Postgres does not resolve output aliases in WHERE, so the two never collide
-- — again, the sort of thing that reads like a bug and needs proving rather
-- than arguing. Also covers starts_with (literal prefix, not a LIKE pattern)
-- and = ANY(uuid[]), which replaced ClickHouse's Array(UUID) binding.
SELECT
  session_id,
  min(user_id)          AS user_id,
  count(*)              AS requests,
  count(DISTINCT model) AS models,
  count(*) OVER ()      AS total_count
FROM public.requests
WHERE session_id IS NOT NULL
  AND user_id IS NOT NULL
  AND starts_with(model, 'gpt-4o')
  AND (provider_key_id IS NULL OR provider_key_id = ANY(ARRAY[gen_random_uuid()]::uuid[]))
GROUP BY session_id
HAVING count(*) > 0
ORDER BY requests DESC
LIMIT 5;

\echo '  8/8 replay insert: multi-row VALUES with ON CONFLICT on the partitioned key'
-- The fallback queue replays rows that already failed once, so it must be safe
-- to run twice. A partitioned table cannot have a unique constraint on id
-- alone, so the conflict target is the primary key (created_at, id).
INSERT INTO public.requests (id, organization_id, project_id, provider, model, created_at)
SELECT gen_random_uuid(), o.id, gen_random_uuid(), 'anthropic', 'claude-sonnet-4', now()
FROM public.organizations o
WHERE o.id = '00000000-0000-4000-8000-00000000f002'
ON CONFLICT (created_at, id) DO NOTHING;

ROLLBACK;

\echo '── all shapes parsed and planned ──'
