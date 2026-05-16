-- Drop the Supabase `requests` table now that all reads + writes have moved
-- to ClickHouse (see docs/plans/clickhouse-migration.md Step 7).
--
-- The table is pre-launch and empty, so there is no data migration.
-- Other Supabase tables that referenced requests(id) via FK keep their
-- `request_id`-style columns as plain UUIDs — they still link to ClickHouse
-- rows by id, just without DB-level enforcement.
--
-- Functions that aggregated over `requests` are dropped here too. Their
-- replacements live in apps/server/src/lib/stats-queries.ts and
-- lib/anomaly.ts (inline ClickHouse SQL).

BEGIN;

-- ── 1. Drop FK constraints first so DROP TABLE doesn't need CASCADE ──────
-- (CASCADE would also remove these but explicit is safer — surfaces any
-- forgotten dependent object before the drop instead of silently nuking it.)
ALTER TABLE public.spans          DROP CONSTRAINT IF EXISTS spans_request_id_fkey;
ALTER TABLE public.eval_results   DROP CONSTRAINT IF EXISTS eval_results_request_id_fkey;
ALTER TABLE public.dataset_items  DROP CONSTRAINT IF EXISTS dataset_items_source_request_id_fkey;
ALTER TABLE public.human_evals    DROP CONSTRAINT IF EXISTS human_evals_request_id_fkey;

-- ── 2. Drop the aggregation RPCs that scanned `requests` ─────────────────
DROP FUNCTION IF EXISTS public.stats_overview(uuid, uuid, timestamptz, timestamptz);
DROP FUNCTION IF EXISTS public.stats_models(uuid, uuid, timestamptz, timestamptz);
DROP FUNCTION IF EXISTS public.stats_timeseries(uuid, uuid, timestamptz, timestamptz, text);
DROP FUNCTION IF EXISTS public.detect_anomaly_stats(uuid, timestamptz, timestamptz, uuid);
DROP FUNCTION IF EXISTS public.get_anomaly_factors(uuid, text, text, timestamptz, timestamptz, uuid);
DROP FUNCTION IF EXISTS public.security_summary(uuid, int);
DROP FUNCTION IF EXISTS public.get_user_analytics(uuid, uuid, text, timestamptz, timestamptz, text, text, int, int);

-- ── 3. Drop the table itself ─────────────────────────────────────────────
DROP TABLE IF EXISTS public.requests;

COMMIT;
