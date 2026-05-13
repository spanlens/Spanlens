-- Experiments: offline side-by-side comparison of two prompt versions on a dataset.
--
-- DIFFERS FROM Prompts A/B (prompt_ab_experiments):
--   - A/B routes production traffic, takes days, exposes real users
--   - Experiments runs offline on a fixed dataset, takes minutes, no user exposure
--
-- Workflow:
--   1. Pick version_a, version_b, dataset, optional evaluator
--   2. Runner re-runs each dataset item through BOTH prompt versions
--   3. Optionally judges each output with the evaluator
--   4. UI shows side-by-side output comparison + score deltas

CREATE TABLE IF NOT EXISTS public.experiments (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name              text        NOT NULL,
  prompt_name       text        NOT NULL,
  version_a_id      uuid        NOT NULL REFERENCES public.prompt_versions(id) ON DELETE RESTRICT,
  version_b_id      uuid        NOT NULL REFERENCES public.prompt_versions(id) ON DELETE RESTRICT,
  dataset_id        uuid        NOT NULL REFERENCES public.datasets(id) ON DELETE RESTRICT,
  evaluator_id      uuid        REFERENCES public.evaluators(id) ON DELETE SET NULL,
  -- Model / provider used to run the prompts (both arms use same setup so the
  -- only variable is the prompt content).
  run_provider      text        NOT NULL CHECK (run_provider IN ('openai', 'anthropic')),
  run_model         text        NOT NULL,
  status            text        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  -- Aggregates populated when status = 'completed'
  total_items       int         NOT NULL DEFAULT 0,
  completed_items   int         NOT NULL DEFAULT 0,
  avg_score_a       numeric,
  avg_score_b       numeric,
  total_cost_usd    numeric     NOT NULL DEFAULT 0,
  error             text,
  created_by        uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  started_at        timestamptz NOT NULL DEFAULT now(),
  completed_at      timestamptz,
  CONSTRAINT exp_version_a_ne_b CHECK (version_a_id <> version_b_id)
);

CREATE INDEX IF NOT EXISTS idx_experiments_org_prompt
  ON public.experiments (organization_id, prompt_name, started_at DESC);

ALTER TABLE public.experiments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "experiments_select_member" ON public.experiments
  FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));

CREATE POLICY "experiments_insert_member" ON public.experiments
  FOR INSERT TO authenticated
  WITH CHECK (public.is_org_member(organization_id));

CREATE POLICY "experiments_update_member" ON public.experiments
  FOR UPDATE TO authenticated
  USING (public.is_org_member(organization_id));

COMMENT ON TABLE public.experiments IS
  'Offline side-by-side comparison: runs dataset items through two prompt versions.';

-- ── experiment_results ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.experiment_results (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  experiment_id    uuid        NOT NULL REFERENCES public.experiments(id) ON DELETE CASCADE,
  dataset_item_id  uuid        NOT NULL REFERENCES public.dataset_items(id) ON DELETE CASCADE,
  -- Per-arm outputs and metrics
  output_a         text,
  output_b         text,
  cost_a_usd       numeric     NOT NULL DEFAULT 0,
  cost_b_usd       numeric     NOT NULL DEFAULT 0,
  latency_a_ms     int,
  latency_b_ms     int,
  tokens_a         int         NOT NULL DEFAULT 0,
  tokens_b         int         NOT NULL DEFAULT 0,
  -- Optional judge scores (when experiment.evaluator_id is set)
  score_a          numeric,
  score_b          numeric,
  reasoning_a      text,
  reasoning_b      text,
  error_a          text,
  error_b          text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_experiment_results_exp
  ON public.experiment_results (experiment_id);

ALTER TABLE public.experiment_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "experiment_results_select_member" ON public.experiment_results
  FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));

CREATE POLICY "experiment_results_insert_member" ON public.experiment_results
  FOR INSERT TO authenticated
  WITH CHECK (public.is_org_member(organization_id));

COMMENT ON TABLE public.experiment_results IS
  'Per dataset-item result for an experiment: outputs from both arms + optional judge scores.';
