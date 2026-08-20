-- Restore `public.requests` in Postgres, replacing the ClickHouse table.
--
-- Background: `requests` moved to ClickHouse in May 2026 (migration
-- 20260516000000_drop_requests_table.sql). ClickHouse Cloud bills compute by
-- wall-clock uptime and suspends only after 15 quiet minutes, so a service
-- holding 3,026 rows and serving ~15 requests/day still cost ~$186/month. The
-- workload never grew into the shape ClickHouse is good at. See
-- docs/plans/postgres-migration.md for the full analysis.
--
-- ensure_requests_partitions() keeps three months ahead and one month behind,
-- called daily by the /cron/maintain-request-partitions job. That job also
-- drops partitions past the retention ceiling, which is the hard-delete half
-- of the retention policy.
--
-- Shape notes, in the order someone reading the DDL will hit them:
--
--   * Columns mirror the ClickHouse table exactly (31 of them). This is not
--     the moment to redesign the schema — a parity check between two stores
--     is only meaningful if the column sets match.
--
--   * `request_body` / `response_body` are `text`, not `jsonb`. Provider
--     responses are not guaranteed to be valid JSON, `jsonb` normalises key
--     order and whitespace (so the stored bytes stop matching what the
--     provider sent), and parsing costs time on the write path. The two
--     columns that genuinely need JSON operators — `flags` and
--     `response_flags` — are `jsonb`.
--
--   * `trace_id` / `span_id` are `text`, matching the pre-ClickHouse schema.
--     ClickHouse typed them `Nullable(UUID)` and rejected the whole row when a
--     caller sent something else, which is why proxy/shared/log-base.ts
--     validates them today. That validation stays as a warning, but a bad
--     value can no longer cost us the row.
--
--   * `has_security_flags` is a plain boolean. An earlier migration
--     (20260430120000) defined it as GENERATED ALWAYS AS ... STORED; lib/logger.ts
--     writes the column explicitly, and Postgres rejects an explicit value for
--     a generated column. Copying the old definition would break every insert.
--
--   * `response_flags` defaults to '[]', not '{}'. lib/logger.ts stores
--     JSON.stringify(responseFlags) where responseFlags is an array, and
--     api/requests.ts falls back to [] when reading it.
--
--   * `truncated` and `cache_hit` are booleans. ClickHouse stored them as
--     UInt8 0/1 because it has no boolean; the logger will send real booleans.
--
-- Partitioning: monthly RANGE partitions on created_at, replacing ClickHouse's
-- PARTITION BY toYYYYMM + TTL. Retention becomes "drop the old partition",
-- which is O(1) and leaves no bloat, unlike a bulk DELETE. A partitioned
-- table's primary key must contain the partition key, hence (created_at, id)
-- rather than id alone.

BEGIN;

CREATE TABLE IF NOT EXISTS public.requests (
  id                 uuid        NOT NULL DEFAULT gen_random_uuid(),

  -- ON DELETE CASCADE closes a gap that existed for as long as the logs lived
  -- in ClickHouse: deleting an organization left its prompt and response
  -- bodies behind, because nothing cascaded across the database boundary.
  organization_id    uuid        NOT NULL
                                 REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id         uuid        NOT NULL,
  api_key_id         uuid,

  provider           text        NOT NULL,
  model              text        NOT NULL,

  prompt_tokens      integer     NOT NULL DEFAULT 0,
  completion_tokens  integer     NOT NULL DEFAULT 0,
  total_tokens       integer     NOT NULL DEFAULT 0,
  cache_read_tokens  integer     NOT NULL DEFAULT 0,
  cache_write_tokens integer     NOT NULL DEFAULT 0,

  cost_usd           numeric(18, 8),
  latency_ms         integer     NOT NULL DEFAULT 0,
  proxy_overhead_ms  integer,
  status_code        integer     NOT NULL DEFAULT 0,

  request_body       text        NOT NULL DEFAULT '',
  response_body      text        NOT NULL DEFAULT '',
  error_message      text,

  trace_id           text,
  span_id            text,
  prompt_version_id  uuid,
  provider_key_id    uuid,

  user_id            text,
  session_id         text,

  flags              jsonb       NOT NULL DEFAULT '[]'::jsonb,
  response_flags     jsonb       NOT NULL DEFAULT '[]'::jsonb,
  has_security_flags boolean     NOT NULL DEFAULT false,
  truncated          boolean     NOT NULL DEFAULT false,
  cache_hit          boolean     NOT NULL DEFAULT false,
  service_tier       text        NOT NULL DEFAULT '',

  created_at         timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (created_at, id)
) PARTITION BY RANGE (created_at);

-- getSecuritySummary unrolls `flags` with jsonb_array_elements, which raises
-- and kills the whole query if a single row holds a scalar or an object
-- instead of an array. Enforcing the shape on write keeps reads simple.
ALTER TABLE public.requests
  DROP CONSTRAINT IF EXISTS requests_flags_is_array;
ALTER TABLE public.requests
  ADD CONSTRAINT requests_flags_is_array
  CHECK (jsonb_typeof(flags) = 'array' AND jsonb_typeof(response_flags) = 'array');

-- Bodies are the bulk of the row. lz4 is Postgres's answer to the ZSTD codec
-- the ClickHouse columns used: worse ratio, better speed, and it only kicks in
-- past the TOAST threshold anyway.
--
-- Whether this propagates to partitions created later is not guaranteed for
-- column-level storage attributes (unlike indexes, which do propagate), so
-- ensure_requests_partitions() sets it explicitly on each new partition.
ALTER TABLE public.requests
  ALTER COLUMN request_body  SET COMPRESSION lz4,
  ALTER COLUMN response_body SET COMPRESSION lz4;

ALTER TABLE public.requests ENABLE ROW LEVEL SECURITY;

-- Every server read goes through service_role or the pooled application
-- connection, both of which bypass RLS; tenant isolation is enforced in
-- lib/requests-query.ts. This policy is the backstop for the day someone
-- grants anon or authenticated access to the table by accident. Same pattern
-- as 20260521000300_deny_default_rls_policies.sql.
DROP POLICY IF EXISTS requests_deny_public ON public.requests;
CREATE POLICY requests_deny_public ON public.requests
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

-- ── Indexes ──────────────────────────────────────────────────────────────
-- Created on the parent, so future partitions inherit them automatically.

-- The path every tenant-scoped read takes, and what keeps the monthly quota
-- count off a sequential scan.
CREATE INDEX IF NOT EXISTS requests_org_created_idx
  ON public.requests (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS requests_project_created_idx
  ON public.requests (project_id, created_at DESC);

-- Single-row lookups by id (/requests/:id). A partitioned index cannot be
-- global, so this resolves to one index scan per partition under an Append.
-- Acceptable at monthly granularity; if the detail route ever gets hot, pass
-- created_at alongside the id so the planner can prune.
CREATE INDEX IF NOT EXISTS requests_id_idx
  ON public.requests (id);

CREATE INDEX IF NOT EXISTS requests_org_user_created_idx
  ON public.requests (organization_id, user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS requests_org_session_created_idx
  ON public.requests (organization_id, session_id, created_at DESC)
  WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS requests_org_security_created_idx
  ON public.requests (organization_id, created_at DESC)
  WHERE has_security_flags;

-- stale-key-digest and api/provider-keys both ask "when did this key last get
-- used", grouped by provider_key_id.
CREATE INDEX IF NOT EXISTS requests_provider_key_created_idx
  ON public.requests (provider_key_id, created_at DESC)
  WHERE provider_key_id IS NOT NULL;

-- ── Partition management ─────────────────────────────────────────────────

-- An earlier draft of this file took only months_ahead. Adding a defaulted
-- second argument would create a second function rather than replace the
-- first, leaving both callable, so the one-argument form goes explicitly.
DROP FUNCTION IF EXISTS public.ensure_requests_partitions(integer);

-- Creates the monthly partitions around now, and is called by the partition
-- cron.
--
-- A month with no partition is not a benign failure. Rows land in the DEFAULT
-- partition, and once they do, creating the real partition for that range
-- FAILS: Postgres scans DEFAULT under ACCESS EXCLUSIVE to prove there is no
-- conflict, which blocks writes on the proxy path while it runs. Recovering
-- means detaching DEFAULT, moving the rows, and reattaching. Everything about
-- the two arguments below is an attempt to never get there.
--
-- months_ahead covers the scheduler. Vercel cron jobs have gone days without
-- firing (CLAUDE.md gotcha #32), so one missed run should cost nothing.
--
-- months_back covers the writers that backdate, of which there are three:
-- the fallback queue replays rows up to seven days old, so a replay on the
-- 2nd of a month targets the previous one; a backfill from an older store
-- spans however far back its export goes; and the seed scripts spread
-- synthetic traffic over past days. One month of history kept warm costs an
-- empty partition. A backfill should pass a months_back covering its range.
CREATE OR REPLACE FUNCTION public.ensure_requests_partitions(
  months_ahead integer DEFAULT 3,
  months_back  integer DEFAULT 1
)
RETURNS TABLE (partition_name text, created boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  m           integer;
  range_start date;
  range_end   date;
  part_name   text;
  existed     boolean;
BEGIN
  FOR m IN -GREATEST(months_back, 0)..GREATEST(months_ahead, 0) LOOP
    range_start := date_trunc('month', now())::date + (m || ' months')::interval;
    range_end   := range_start + interval '1 month';
    part_name   := 'requests_' || to_char(range_start, 'YYYY_MM');

    SELECT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = part_name
    ) INTO existed;

    IF NOT existed THEN
      EXECUTE format(
        'CREATE TABLE public.%I PARTITION OF public.requests FOR VALUES FROM (%L) TO (%L)',
        part_name, range_start, range_end
      );
      -- Column compression is not reliably inherited by new partitions the way
      -- indexes are, so set it here rather than assuming.
      EXECUTE format(
        'ALTER TABLE public.%I ALTER COLUMN request_body SET COMPRESSION lz4,'
        || ' ALTER COLUMN response_body SET COMPRESSION lz4',
        part_name
      );
    END IF;

    partition_name := part_name;
    created := NOT existed;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_requests_partitions(integer, integer) FROM PUBLIC, anon, authenticated;

-- Catch-all so a partition-creation miss degrades into "rows are in the wrong
-- place" rather than "the proxy cannot log anything". Anything landing here is
-- an incident: the partition cron did not run. The cron alerts on a non-zero
-- count.
CREATE TABLE IF NOT EXISTS public.requests_default PARTITION OF public.requests DEFAULT;

SELECT public.ensure_requests_partitions(3, 1);

-- ── Retire the functions that outlived the old table ─────────────────────
--
-- 20260516000000 dropped seven aggregate RPCs but missed these four, which
-- have been sitting in the database ever since referencing a table that did
-- not exist. Postgres does not track dependencies through function bodies, so
-- nothing complained.
--
-- They matter now because recreating `requests` makes them callable again, and
-- their behaviour no longer matches the TypeScript that replaced them —
-- get_model_aggregates, for one, carries a null-token guard that
-- lib/model-recommend.ts does not. Reviving that silently would be a
-- behaviour change dressed up as a restore. Nothing calls any of them
-- (verified against every .rpc( call site), so they go.
--
-- If the aggregation logic is wanted later, the definitions are in git:
-- 20260430140000, 20260507010100, 20260507010000, 20260421010000.
DROP FUNCTION IF EXISTS public.get_model_aggregates(uuid, timestamptz, integer[]);
DROP FUNCTION IF EXISTS public.get_model_percentiles(uuid, text, text, timestamptz);
DROP FUNCTION IF EXISTS public.get_model_prior_window_cost(uuid, text, text, timestamptz, timestamptz);
DROP FUNCTION IF EXISTS public.aggregate_usage_daily(date);

COMMIT;
