-- Extend evaluators.type CHECK to all six evaluator types.
--
-- 20260609130000_evaluators_type_check_extend.sql widened the constraint to
-- ('llm_judge','regex','json_schema'). exact_match + contains (PR #347) and
-- embedding (PR #348) were added in the app layer (api/evals.ts validation +
-- the runner) but the CHECK was NOT widened, so INSERTing an evaluator of
-- those types fails in production with a 23514 check_violation. (supabaseAdmin
-- is an untyped client, so the bad INSERT compiles cleanly — the DB is the
-- only thing that rejects it.) This restores the missing migration.
--
-- Constraint name is looked up via pg_constraint rather than hard-coded
-- (same pattern as 20260609130000). Idempotent: the DROP runs first, so a
-- re-apply re-creates the constraint cleanly.

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
  CHECK (type IN ('llm_judge', 'regex', 'json_schema', 'exact_match', 'contains', 'embedding'));

COMMENT ON COLUMN evaluators.type IS
  'Evaluator family. ''llm_judge'' uses an LLM-as-judge prompt; ''regex'' / ''json_schema'' / ''exact_match'' / ''contains'' are deterministic over the response text; ''embedding'' scores cosine similarity vs a reference. config JSON shape is type-dependent: see apps/server/src/lib/eval-runner.ts for the per-type contract.';
