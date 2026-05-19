-- ─────────────────────────────────────────────────────────────────────────────
-- Model prices: history tracking + admin-managed runtime updates
--
-- WHY: P2.1 — make model pricing changes hot-deployable. Before this migration,
-- prices lived in `apps/server/src/lib/cost.ts` as a hardcoded TypeScript const,
-- so every price update required a code deploy. After this migration, the
-- server reads prices from `model_prices` via an in-memory cache (5-min TTL)
-- with hardcoded fallback for cold-start safety.
--
-- WHAT CHANGES:
--   1. `model_prices.effective_from` — when this price row started applying.
--      Existing rows backfill to the row's `created_at` (preserves audit).
--   2. `model_price_history` — append-only changelog. Every UPDATE to
--      `model_prices` writes a row here via trigger. Lets admins answer
--      "what was the price of gpt-4o on 2026-04-01?".
--   3. Admin-only RLS for INSERT/UPDATE — public SELECT stays open (already
--      set in initial_schema), but writes require service_role (server-side)
--      so the admin API in apps/server can mutate while client SDKs cannot.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. effective_from on model_prices (default = creation time)
ALTER TABLE model_prices
  ADD COLUMN IF NOT EXISTS effective_from TIMESTAMPTZ NOT NULL DEFAULT now();

COMMENT ON COLUMN model_prices.effective_from IS
  'When this price row started being effective. Used by cost calculations only via current-row lookup today; historical-rate replay would join through model_price_history.';

-- Backfill: rows created before this migration set effective_from to created_at
UPDATE model_prices
  SET effective_from = created_at
  WHERE effective_from > created_at;

-- 2. model_price_history — append-only changelog
CREATE TABLE IF NOT EXISTS model_price_history (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_price_id           UUID NOT NULL REFERENCES model_prices(id) ON DELETE CASCADE,
  provider                 TEXT NOT NULL,
  model                    TEXT NOT NULL,
  prompt_price_per_1m      NUMERIC(10, 6) NOT NULL,
  completion_price_per_1m  NUMERIC(10, 6) NOT NULL,
  cache_read_price_per_1m  NUMERIC(10, 6),
  cache_write_price_per_1m NUMERIC(10, 6),
  changed_by               UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  change_kind              TEXT NOT NULL CHECK (change_kind IN ('insert', 'update', 'delete')),
  changed_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_model_price_history_model
  ON model_price_history (provider, model, changed_at DESC);

ALTER TABLE model_price_history ENABLE ROW LEVEL SECURITY;

-- Admin read-only. Writes are trigger-driven (service_role).
-- Admin scoping is enforced in the API layer via is_org_admin() rather than
-- here, because model_price_history is global (no org scope) and we want all
-- writes to come from the server side using supabaseAdmin.
CREATE POLICY "model_price_history_admin_select" ON model_price_history
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM org_members om
      WHERE om.user_id = auth.uid() AND om.role = 'admin'
    )
  );

-- 3. Trigger that mirrors INSERT/UPDATE/DELETE on model_prices into history.
-- changed_by is read from session GUC `spanlens.actor_user_id` (set by API
-- middleware before mutations) — falls back to NULL if not set (e.g. seed
-- script).
CREATE OR REPLACE FUNCTION log_model_price_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_actor UUID;
BEGIN
  BEGIN
    v_actor := nullif(current_setting('spanlens.actor_user_id', true), '')::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_actor := NULL;
  END;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO model_price_history (
      model_price_id, provider, model,
      prompt_price_per_1m, completion_price_per_1m,
      cache_read_price_per_1m, cache_write_price_per_1m,
      changed_by, change_kind
    ) VALUES (
      NEW.id, NEW.provider, NEW.model,
      NEW.prompt_price_per_1m, NEW.completion_price_per_1m,
      NEW.cache_read_price_per_1m, NEW.cache_write_price_per_1m,
      v_actor, 'insert'
    );
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Only log if any pricing column actually changed
    IF NEW.prompt_price_per_1m IS DISTINCT FROM OLD.prompt_price_per_1m
       OR NEW.completion_price_per_1m IS DISTINCT FROM OLD.completion_price_per_1m
       OR NEW.cache_read_price_per_1m IS DISTINCT FROM OLD.cache_read_price_per_1m
       OR NEW.cache_write_price_per_1m IS DISTINCT FROM OLD.cache_write_price_per_1m
    THEN
      INSERT INTO model_price_history (
        model_price_id, provider, model,
        prompt_price_per_1m, completion_price_per_1m,
        cache_read_price_per_1m, cache_write_price_per_1m,
        changed_by, change_kind
      ) VALUES (
        NEW.id, NEW.provider, NEW.model,
        NEW.prompt_price_per_1m, NEW.completion_price_per_1m,
        NEW.cache_read_price_per_1m, NEW.cache_write_price_per_1m,
        v_actor, 'update'
      );
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO model_price_history (
      model_price_id, provider, model,
      prompt_price_per_1m, completion_price_per_1m,
      cache_read_price_per_1m, cache_write_price_per_1m,
      changed_by, change_kind
    ) VALUES (
      OLD.id, OLD.provider, OLD.model,
      OLD.prompt_price_per_1m, OLD.completion_price_per_1m,
      OLD.cache_read_price_per_1m, OLD.cache_write_price_per_1m,
      v_actor, 'delete'
    );
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS model_prices_history_trigger ON model_prices;
CREATE TRIGGER model_prices_history_trigger
  AFTER INSERT OR UPDATE OR DELETE ON model_prices
  FOR EACH ROW EXECUTE FUNCTION log_model_price_change();

-- 4. RPC wrapper for the API to set the actor GUC before a mutation.
-- Supabase's PostgREST exposes RPCs as `supabaseAdmin.rpc(name, ...)`. The
-- API calls this immediately before INSERT/UPDATE/DELETE so the trigger
-- can pick up `changed_by`. SECURITY DEFINER lets it run with whatever
-- the function owner can do; we still restrict execution to service_role.
CREATE OR REPLACE FUNCTION set_spanlens_actor(actor_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM set_config('spanlens.actor_user_id', actor_id::text, true);
END;
$$;

REVOKE ALL ON FUNCTION set_spanlens_actor(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_spanlens_actor(UUID) TO service_role;
