-- P2-11: agent trajectory evaluation.
--
-- Existing evaluators score a single response text. A trajectory evaluator
-- (evaluators.type='trajectory') scores the whole agent TRACE — the ordered
-- sequence of spans (LLM + tool calls) — against a criterion, reusing the
-- tracing data that is Spanlens's differentiator.
--
-- A trajectory evaluator targets traces by NAME (stored in its config jsonb),
-- not a prompt version. So a trajectory eval_run has no prompt_version_id —
-- make it nullable — and records the trace name it sampled. Per-result rows
-- link to the evaluated trace instead of a request / dataset item.
--
-- All additive (gotcha #25). Widening the evaluators type CHECK is mandatory:
-- the untyped supabaseAdmin client would otherwise INSERT a 'trajectory' row
-- that fails at runtime with 23514 (gotcha: PR #347/#348 hit exactly this).

-- 1) Allow the 'trajectory' evaluator type. Drop + re-add so the migration is
--    idempotent regardless of which prior types the CHECK already listed.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.evaluators'::regclass AND conname = 'evaluators_type_check'
  ) THEN
    ALTER TABLE evaluators DROP CONSTRAINT evaluators_type_check;
  END IF;
  ALTER TABLE evaluators ADD CONSTRAINT evaluators_type_check CHECK (
    type IN ('llm_judge', 'regex', 'json_schema', 'exact_match', 'contains', 'embedding', 'trajectory')
  );
END $$;

-- 2) A trajectory run has no prompt version. Make the column nullable (existing
--    rows keep their value; this is a non-breaking relaxation) and record the
--    trace name that was sampled.
ALTER TABLE eval_runs ALTER COLUMN prompt_version_id DROP NOT NULL;
ALTER TABLE eval_runs ADD COLUMN IF NOT EXISTS trace_name text;

-- 3) Per-result link to the evaluated trace (NULL for non-trajectory results,
--    which use request_id / dataset_item_id). No FK — same pragmatic choice as
--    spans.parent_span_id (gotcha #4): traces can be pruned independently.
ALTER TABLE eval_results ADD COLUMN IF NOT EXISTS trace_id uuid;
