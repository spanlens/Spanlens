-- Migration: eval_results.score DROP NOT NULL
--
-- The score-type system (20260608010000 / 20260608020000) introduced four
-- typed value columns: value_number / value_string / value_boolean (and the
-- legacy numeric score). For NUMERIC configs the legacy score column is
-- mirrored from value_number; but CATEGORICAL / BOOLEAN / TEXT results have
-- no meaningful number to put in score, and writers had to fill a sentinel
-- (0) just to satisfy the NOT NULL constraint. That sentinel was indistinct
-- from a real "score = 0" answer and broke any downstream consumer that
-- treated score as the source of truth.
--
-- The companion column on human_evals was already made nullable in
-- 20260608010000. This migration mirrors that on eval_results so the typed
-- pathway can land cleanly. validateScore() in lib/score-validation.ts
-- guarantees that exactly one of (score / value_number / value_string /
-- value_boolean) is non-null per row, so downstream readers that previously
-- assumed score IS NOT NULL must now check the score_config_id + typed
-- value columns instead.
--
-- Backward compatibility: NUMERIC evaluators (the only kind in production
-- before the score-type rollout) keep writing both score and value_number,
-- so dashboards that read score directly stay unaffected. Only the new
-- CATEGORICAL / BOOLEAN / TEXT inserts produce score=NULL rows.

ALTER TABLE eval_results ALTER COLUMN score DROP NOT NULL;

COMMENT ON COLUMN eval_results.score IS
  'Legacy numeric score. Mirrored from value_number for NUMERIC score_configs; NULL for CATEGORICAL/BOOLEAN/TEXT (see lib/score-validation.ts).';
