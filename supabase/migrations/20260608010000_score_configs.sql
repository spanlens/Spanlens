-- 20260608010000_score_configs.sql
--
-- Typed score configs for evals + human feedback.
--
-- Before this migration, every eval result and every human feedback row
-- carried a single `score float` column normalized to 0..1. That's
-- enough for "helpfulness on a slider" but it can't represent:
--
--   • CATEGORICAL: A/B preference, persona match { 'on_brand', 'off_brand' }
--   • BOOLEAN: pass/fail toggles (toxicity, PII leak, prompt injection)
--   • TEXT: free-form labels or reviewer comments treated as the primary
--     scoring signal (rare but Langfuse supports it; we match)
--
-- We introduce a `score_configs` table that defines, per workspace, the
-- shape of a score: its name (e.g. "Helpfulness"), its type, and
-- type-specific bounds (numeric min/max, categorical category list).
--
-- The result tables (`eval_results`, `human_evals`) gain a nullable
-- `score_config_id` pointer plus three typed value columns
-- (`value_number`, `value_string`, `value_boolean`). Exactly one of
-- the value columns may be non-null for a given row. The legacy
-- `score float` column stays and is filled with the same value as
-- `value_number` whenever the config is NUMERIC, so every existing
-- dashboard query keeps working without changes.
--
-- Why a separate score_configs table per workspace (not a global
-- enum or a free-text column):
--   • Each workspace wants its own vocabulary. Acme Corp's eval names
--     ("brand voice", "compliance") aren't ours to predict.
--   • Categorical configs need a fixed allow-list of values; storing
--     it on the config row is cheaper than re-validating each insert
--     against a side table.
--   • Future per-workspace defaults (e.g. "every new evaluator gets
--     the Helpfulness config attached") need stable IDs.

-- ── Configs table ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS score_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Display name shown in dropdowns and chart titles.
  name TEXT NOT NULL,
  -- Short description for the management UI; nullable for legacy defaults.
  description TEXT,

  data_type TEXT NOT NULL CHECK (
    data_type IN ('NUMERIC', 'CATEGORICAL', 'BOOLEAN', 'TEXT')
  ),

  -- NUMERIC bounds. Both NULL when type != NUMERIC. min < max enforced
  -- at the application layer (a CHECK across nullable columns is awkward
  -- and we want to surface user-friendly errors anyway).
  min_value DOUBLE PRECISION,
  max_value DOUBLE PRECISION,

  -- CATEGORICAL category list as JSONB array of strings. NULL for other
  -- types. We use JSONB instead of text[] so the column is queryable
  -- with `jsonb_array_elements_text()` without an explicit cast and
  -- because PostgREST surfaces JSONB as native JSON in the API.
  categories JSONB,

  -- BOOLEAN labels for the "true" / "false" sides of the toggle. Stored
  -- once so the UI doesn't need to hard-code "Pass / Fail" forever.
  -- Falls back to "Yes" / "No" in the UI when NULL.
  bool_true_label TEXT,
  bool_false_label TEXT,

  -- Soft-delete flag so existing eval_results pointing at the config
  -- don't break when a workspace archives it. The CRUD UI hides
  -- archived configs from the picker but keeps them queryable for
  -- historical charts.
  archived_at TIMESTAMPTZ,

  -- Marks the default config a workspace gets pre-seeded with. The
  -- backfill below sets one per existing org so the picker isn't
  -- empty for legacy rows.
  is_default BOOLEAN NOT NULL DEFAULT false,

  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Name uniqueness across active rows only — archived rows can share
  -- a name with the new active row that replaced them.
  CONSTRAINT score_configs_name_unique_per_org
    UNIQUE (organization_id, name)
);

CREATE INDEX IF NOT EXISTS score_configs_org_active_idx
  ON score_configs (organization_id, created_at DESC)
  WHERE archived_at IS NULL;

-- At most one default per workspace. Backfill below enforces this
-- on existing rows.
CREATE UNIQUE INDEX IF NOT EXISTS score_configs_default_uniq
  ON score_configs (organization_id)
  WHERE is_default = true AND archived_at IS NULL;

ALTER TABLE score_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY score_configs_select_org_members ON score_configs
  FOR SELECT USING (is_org_member(organization_id));

CREATE POLICY score_configs_deny_writes ON score_configs
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

CREATE POLICY score_configs_service_role_all ON score_configs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── eval_results: typed value columns ────────────────────────────────────────

ALTER TABLE eval_results
  ADD COLUMN IF NOT EXISTS score_config_id UUID
    REFERENCES score_configs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS value_number DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS value_string TEXT,
  ADD COLUMN IF NOT EXISTS value_boolean BOOLEAN;

-- Existing rows: leave score_config_id NULL. Aggregation code falls
-- back to the legacy `score` column when the config pointer is missing.

CREATE INDEX IF NOT EXISTS eval_results_score_config_idx
  ON eval_results (score_config_id)
  WHERE score_config_id IS NOT NULL;

-- ── human_evals: typed value columns ─────────────────────────────────────────

ALTER TABLE human_evals
  ADD COLUMN IF NOT EXISTS score_config_id UUID
    REFERENCES score_configs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS value_number DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS value_string TEXT,
  ADD COLUMN IF NOT EXISTS value_boolean BOOLEAN;

CREATE INDEX IF NOT EXISTS human_evals_score_config_idx
  ON human_evals (score_config_id)
  WHERE score_config_id IS NOT NULL;

-- Drop the NOT NULL on human_evals.score so new categorical/boolean/text
-- rows can save without inventing a fake float. Existing rows keep their
-- score values.
ALTER TABLE human_evals ALTER COLUMN score DROP NOT NULL;

-- ── updated_at trigger for score_configs ─────────────────────────────────────
-- Mirrors the pattern used by other config-style tables in this schema
-- (alerts, webhooks). Keeps audit-log entries showing meaningful update
-- timestamps without the API having to remember to set them.

CREATE OR REPLACE FUNCTION score_configs_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS score_configs_updated_at_trg ON score_configs;
CREATE TRIGGER score_configs_updated_at_trg
  BEFORE UPDATE ON score_configs
  FOR EACH ROW
  EXECUTE FUNCTION score_configs_touch_updated_at();

-- ── Backfill: one default NUMERIC config per existing organization ───────────
-- Idempotent: skips any org that already has a default. Run order matters
-- because the unique index above forbids two defaults per org.

INSERT INTO score_configs (organization_id, name, description, data_type, min_value, max_value, is_default)
SELECT
  o.id,
  'Helpfulness',
  'Default numeric score, 0 (not helpful) to 1 (fully addresses the user). Pre-seeded for backward compatibility.',
  'NUMERIC',
  0.0,
  1.0,
  true
FROM organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM score_configs sc
  WHERE sc.organization_id = o.id
    AND sc.is_default = true
    AND sc.archived_at IS NULL
);
