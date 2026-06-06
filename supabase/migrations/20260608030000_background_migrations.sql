-- 20260608030000_background_migrations.sql
--
-- Background migration framework. Lets us land a schema change that
-- needs to backfill a billion-row table without blocking a single
-- request and without blowing past Vercel's 5-minute function timeout.
--
-- The pattern (lifted from Langfuse, who lifted it from PostHog):
--
--   1. The schema migration lands first, adding the new columns
--      nullable or with a safe default.
--   2. A code change registers a `BackgroundMigration` with a
--      `runChunk(state)` method that processes a bounded slice
--      (e.g. 5000 rows) and returns the next cursor.
--   3. A cron (5-minute schedule) picks up `status='pending'` rows,
--      grabs a Postgres advisory lock so two workers don't race,
--      runs chunks until the Vercel function gets close to its
--      timeout, saves the cursor in `state`, then yields.
--   4. The next cron tick resumes from `state`. Eventually
--      `runChunk` returns `done: true` and the row flips to
--      `status='completed'`.
--
-- A heartbeat on `last_heartbeat_at` lets us recover from a worker
-- that crashed mid-chunk: the next tick treats any 'running' row
-- whose heartbeat is older than 60s as crashed and reclaims it.

CREATE TABLE IF NOT EXISTS background_migrations (
  -- The registry name (e.g. 'backfill_request_cost_v2'). We use a
  -- TEXT PK instead of a UUID so the cron logs name the migration
  -- inline and the registry doesn't need a UUID lookup table.
  name TEXT PRIMARY KEY,

  -- Human-facing description shown in the admin UI.
  description TEXT NOT NULL,

  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'running', 'completed', 'failed', 'cancelled')
  ),

  -- Free-form JSONB the runner uses to resume work. Schema is
  -- migration-specific (e.g. {"last_processed_id": "abc"} or
  -- {"chunk_index": 42}). Kept opaque from the framework's side so
  -- a migration can evolve its state shape without a schema change.
  state JSONB NOT NULL DEFAULT '{}'::JSONB,

  -- Progress hints for the admin UI. Optional — a migration that
  -- can't cheaply count rows leaves them null and the UI shows a
  -- spinner.
  progress_current BIGINT,
  progress_total BIGINT,

  -- Heartbeat sentinel — every chunk run touches this. The cron
  -- treats `status='running' AND last_heartbeat_at < now - 60s` as
  -- a crashed worker and reclaims the row.
  last_heartbeat_at TIMESTAMPTZ,

  -- Audit trail.
  error_message TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS background_migrations_status_idx
  ON background_migrations (status, created_at)
  WHERE status IN ('pending', 'running');

ALTER TABLE background_migrations ENABLE ROW LEVEL SECURITY;

-- Reads gated to org admins so a non-admin member can't poke around
-- the maintenance UI. Note that the table has NO org_id — these are
-- platform-level migrations, not per-workspace. The check below uses
-- the global admin allow-list (SPANLENS_ADMIN_EMAILS) via a future
-- SECURITY DEFINER helper. Until that helper lands, only the
-- service_role can read; the admin UI hits the server, not Supabase
-- directly.
CREATE POLICY background_migrations_deny_all ON background_migrations
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

CREATE POLICY background_migrations_service_role_all ON background_migrations
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Bump updated_at on every UPDATE so the admin UI can sort "recently
-- touched" reliably.
CREATE OR REPLACE FUNCTION background_migrations_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS background_migrations_updated_at_trg ON background_migrations;
CREATE TRIGGER background_migrations_updated_at_trg
  BEFORE UPDATE ON background_migrations
  FOR EACH ROW
  EXECUTE FUNCTION background_migrations_touch_updated_at();

-- ── Advisory-lock helpers ────────────────────────────────────────────────────
-- Wrap pg_try_advisory_lock / pg_advisory_unlock in SECURITY DEFINER
-- functions so the runner can call them through PostgREST's RPC
-- interface without needing direct access to the pg system catalog.
--
-- We hash the migration name into a bigint via hashtext() so we don't
-- have to maintain a name→int mapping table. Two-arg form
-- (classid, objid) gives us 2×32 bits of key space, more than enough
-- for a migration registry.

CREATE OR REPLACE FUNCTION try_advisory_lock_for_migration(p_name TEXT)
RETURNS BOOLEAN AS $$
  SELECT pg_try_advisory_lock(
    -- Stable classid so collisions across unrelated advisory locks in
    -- other parts of the system stay separated.
    789456123::int,
    hashtext(p_name)
  );
$$ LANGUAGE sql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION release_advisory_lock_for_migration(p_name TEXT)
RETURNS BOOLEAN AS $$
  SELECT pg_advisory_unlock(789456123::int, hashtext(p_name));
$$ LANGUAGE sql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION try_advisory_lock_for_migration(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION release_advisory_lock_for_migration(TEXT) TO service_role;
