-- Evals: LLM-as-judge evaluation infrastructure for prompt versions.
--
-- An evaluator defines "how to score" (criterion + judge model).
-- An eval_run is a single execution of that evaluator over N samples.
-- An eval_result is the score for one sample (one request or one dataset item).
--
-- MVP scope:
--   - Evaluator type: 'llm_judge' only (heuristic etc. in Phase 2)
--   - Source: 'production' only (dataset support comes with Datasets tab)

CREATE TABLE IF NOT EXISTS public.evaluators (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  prompt_name     text        NOT NULL,
  name            text        NOT NULL,
  type            text        NOT NULL DEFAULT 'llm_judge'
                              CHECK (type IN ('llm_judge')),
  -- For llm_judge: { criterion, judge_provider, judge_model, scale_min, scale_max }
  config          jsonb       NOT NULL,
  created_by      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz
);

CREATE INDEX IF NOT EXISTS idx_evaluators_org_prompt
  ON public.evaluators (organization_id, prompt_name)
  WHERE archived_at IS NULL;

ALTER TABLE public.evaluators ENABLE ROW LEVEL SECURITY;

CREATE POLICY "evaluators_select_member" ON public.evaluators
  FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));

CREATE POLICY "evaluators_insert_member" ON public.evaluators
  FOR INSERT TO authenticated
  WITH CHECK (public.is_org_member(organization_id));

CREATE POLICY "evaluators_update_member" ON public.evaluators
  FOR UPDATE TO authenticated
  USING (public.is_org_member(organization_id));

COMMENT ON TABLE public.evaluators IS
  'Defines how to score prompt outputs (criterion + judge model). One row per reusable evaluator.';

-- ── eval_runs ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.eval_runs (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  evaluator_id       uuid        NOT NULL REFERENCES public.evaluators(id) ON DELETE CASCADE,
  prompt_version_id  uuid        NOT NULL REFERENCES public.prompt_versions(id) ON DELETE CASCADE,
  source             text        NOT NULL DEFAULT 'production'
                                 CHECK (source IN ('production', 'dataset')),
  sample_size        int         NOT NULL CHECK (sample_size > 0 AND sample_size <= 1000),
  -- Time window for production sampling (NULL for dataset source).
  sample_from        timestamptz,
  sample_to          timestamptz,
  status             text        NOT NULL DEFAULT 'pending'
                                 CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  -- Populated when status = 'completed'.
  scored_count       int         NOT NULL DEFAULT 0,
  avg_score          numeric,
  total_cost_usd     numeric     NOT NULL DEFAULT 0,
  error              text,
  created_by         uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  started_at         timestamptz NOT NULL DEFAULT now(),
  completed_at       timestamptz
);

CREATE INDEX IF NOT EXISTS idx_eval_runs_evaluator
  ON public.eval_runs (evaluator_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_eval_runs_prompt_version
  ON public.eval_runs (prompt_version_id, status, started_at DESC);

ALTER TABLE public.eval_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "eval_runs_select_member" ON public.eval_runs
  FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));

CREATE POLICY "eval_runs_insert_member" ON public.eval_runs
  FOR INSERT TO authenticated
  WITH CHECK (public.is_org_member(organization_id));

CREATE POLICY "eval_runs_update_member" ON public.eval_runs
  FOR UPDATE TO authenticated
  USING (public.is_org_member(organization_id));

COMMENT ON TABLE public.eval_runs IS
  'One execution of an evaluator over N samples. Holds aggregate score and run metadata.';

-- ── eval_results ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.eval_results (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  eval_run_id     uuid        NOT NULL REFERENCES public.eval_runs(id) ON DELETE CASCADE,
  -- Exactly one of request_id / dataset_item_id is set (dataset_items table
  -- comes in Phase 2; column is nullable now so the schema is forward-compatible).
  request_id      uuid        REFERENCES public.requests(id) ON DELETE SET NULL,
  dataset_item_id uuid,
  score           numeric     NOT NULL,
  reasoning       text,
  judge_cost_usd  numeric     NOT NULL DEFAULT 0,
  judge_tokens    int         NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_eval_results_run
  ON public.eval_results (eval_run_id);

CREATE INDEX IF NOT EXISTS idx_eval_results_request
  ON public.eval_results (request_id)
  WHERE request_id IS NOT NULL;

ALTER TABLE public.eval_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "eval_results_select_member" ON public.eval_results
  FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));

CREATE POLICY "eval_results_insert_member" ON public.eval_results
  FOR INSERT TO authenticated
  WITH CHECK (public.is_org_member(organization_id));

COMMENT ON TABLE public.eval_results IS
  'One score per sample (request or dataset_item). Aggregated into eval_runs.avg_score.';
