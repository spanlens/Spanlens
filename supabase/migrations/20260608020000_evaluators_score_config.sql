-- 20260608020000_evaluators_score_config.sql
--
-- Wire evaluators to the typed score config infrastructure from 4B.1.
--
-- Before this migration every evaluator implicitly produced a NUMERIC
-- 0..1 score: the judge prompt asked the LLM for a number in
-- [scale_min, scale_max], the result was clamped + normalised, and the
-- single `eval_results.score` float was filled.
--
-- After this migration evaluators OPTIONALLY point at a score_config:
--
--   • NULL `score_config_id` → keep the legacy behaviour exactly. The
--     judge is asked for a number, the result lands in `score` /
--     `value_number`. Every existing evaluator falls into this bucket
--     so production eval runs cannot break on deploy.
--   • Non-NULL `score_config_id` → the runner builds a type-aware
--     judge prompt and writes the matching typed column
--     (value_number / value_string / value_boolean) on eval_results.
--
-- We deliberately do NOT backfill score_config_id for existing rows.
-- The migration that introduces categorical / boolean evaluator
-- creation is the same one that lets the user pick a config in the
-- UI, so explicit opt-in is the safer default.

ALTER TABLE evaluators
  ADD COLUMN IF NOT EXISTS score_config_id UUID
    REFERENCES score_configs(id) ON DELETE SET NULL;

-- Partial index so list endpoints that filter by config (future
-- "evaluators using this config" view) stay cheap. Empty for now.
CREATE INDEX IF NOT EXISTS evaluators_score_config_idx
  ON evaluators (score_config_id)
  WHERE score_config_id IS NOT NULL;
