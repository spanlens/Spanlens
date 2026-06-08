-- Migration: extend evaluators.type CHECK with 'regex' and 'json_schema'
--
-- R-7 Phase 1 adds two deterministic evaluator types alongside the
-- existing llm_judge: regex (pattern match against the response text)
-- and json_schema (Ajv validation). Both produce a 0/1 score so they
-- can share the eval_results column shape without schema changes.
--
-- The original CHECK from 20260513000000_evals.sql:17 was inline:
--     CHECK (type IN ('llm_judge'))
-- PostgreSQL auto-named the constraint. The exact name depends on PG
-- version (usually `evaluators_type_check` but we don't want to bet on
-- it), so look it up through pg_constraint instead of hard-coding the
-- DROP target. Same pattern as 20260609120000 for internal_alerts.kind.

DO $$
DECLARE c_name text;
BEGIN
  SELECT conname INTO c_name
  FROM pg_constraint
  WHERE conrelid = 'public.evaluators'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%type%llm_judge%';

  IF c_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE evaluators DROP CONSTRAINT %I', c_name);
  END IF;
END $$;

ALTER TABLE evaluators ADD CONSTRAINT evaluators_type_check
  CHECK (type IN ('llm_judge', 'regex', 'json_schema'));

COMMENT ON COLUMN evaluators.type IS
  'Evaluator family. ''llm_judge'' uses an LLM-as-judge prompt; ''regex'' and ''json_schema'' (R-7 Phase 1, 2026-06-09) are deterministic over the response text. config JSON shape is type-dependent: see apps/server/src/lib/eval-runner.ts for the per-type contract.';
