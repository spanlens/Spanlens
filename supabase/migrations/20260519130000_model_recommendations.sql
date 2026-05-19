-- ─────────────────────────────────────────────────────────────────────────────
-- model_recommendations — substitute-matching rules for the model swap
-- recommendation engine. Migrates the hand-maintained SUBSTITUTES constant
-- in `apps/server/src/lib/model-recommend-rules.ts` into a real table so
-- operators can tune the engine without redeploying.
--
-- WHY: Before P3.3 every rule change required a code change + deploy. After
-- this migration the server reads rules from this table via an in-memory
-- cache (5-min stale-while-revalidate, FALLBACK_RULES for cold start), and
-- admins manage them through `/api/v1/admin/model-recommendations`.
--
-- DESIGN MIRRORS P2.1 (model_prices):
--   • UNIQUE (current_provider, current_model) — one rule per source model.
--   • effective_from for future "what was the rule on date X" analytics
--     (not yet read by the engine; reserved for parity with model_prices).
--   • Public SELECT, service-role-only mutations — admin API runs under
--     supabaseAdmin so RLS bypass is intentional.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS model_recommendations (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  current_provider            TEXT NOT NULL,
  current_model               TEXT NOT NULL,
  suggested_provider          TEXT NOT NULL,
  suggested_model             TEXT NOT NULL,
  -- Multiplier applied to current spend to estimate spend on the substitute.
  -- e.g. 0.06 means the substitute costs 6% of the current spend.
  cost_ratio                  NUMERIC(10, 6) NOT NULL CHECK (cost_ratio > 0),
  max_avg_prompt_tokens       INTEGER NOT NULL CHECK (max_avg_prompt_tokens > 0),
  max_avg_completion_tokens   INTEGER NOT NULL CHECK (max_avg_completion_tokens > 0),
  reason                      TEXT NOT NULL,
  effective_from              TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (current_provider, current_model)
);

ALTER TABLE model_recommendations ENABLE ROW LEVEL SECURITY;

-- Public read so the dashboard can render the cost-savings explanation without
-- a server round-trip. Writes happen via service_role from the admin API only.
CREATE POLICY "model_recommendations_public_select" ON model_recommendations
  FOR SELECT USING (true);

CREATE TRIGGER model_recommendations_updated_at
  BEFORE UPDATE ON model_recommendations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMENT ON TABLE model_recommendations IS
  'Substitute-matching rules for the model swap recommendation engine. DB-driven so operators can tune without redeploying. See lib/model-recommendations-cache.ts (P3.3).';
