-- Datasets: reusable input sets for offline evaluation.
--
-- A dataset is a named collection of (input, expected_output?) pairs.
-- Used by Evals to run a prompt version against a fixed test set instead of
-- production traffic. Future: Experiments will compare versions on a dataset.
--
-- dataset_items.input is jsonb to allow both "variables only" and "messages"
-- shapes. expected_output is optional — only required for accuracy-style evals.

CREATE TABLE IF NOT EXISTS public.datasets (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  description     text,
  created_by      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz,
  UNIQUE (organization_id, name)
);

CREATE INDEX IF NOT EXISTS idx_datasets_org
  ON public.datasets (organization_id)
  WHERE archived_at IS NULL;

ALTER TABLE public.datasets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "datasets_select_member" ON public.datasets
  FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));

CREATE POLICY "datasets_insert_member" ON public.datasets
  FOR INSERT TO authenticated
  WITH CHECK (public.is_org_member(organization_id));

CREATE POLICY "datasets_update_member" ON public.datasets
  FOR UPDATE TO authenticated
  USING (public.is_org_member(organization_id));

CREATE POLICY "datasets_delete_member" ON public.datasets
  FOR DELETE TO authenticated
  USING (public.is_org_member(organization_id));

COMMENT ON TABLE public.datasets IS
  'Named collection of (input, expected_output?) test cases for offline evaluation.';

-- ── dataset_items ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.dataset_items (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  dataset_id        uuid        NOT NULL REFERENCES public.datasets(id) ON DELETE CASCADE,
  -- Two shapes accepted:
  --   { "variables": { "name": "Alice", ... } }     ← for variable-based prompts
  --   { "messages": [{role,content}, ...] }         ← for raw chat input
  input             jsonb       NOT NULL,
  -- Optional reference answer (for accuracy-style judging).
  expected_output   text,
  -- If this item was imported from production traffic.
  source_request_id uuid        REFERENCES public.requests(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dataset_items_dataset
  ON public.dataset_items (dataset_id, created_at DESC);

ALTER TABLE public.dataset_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dataset_items_select_member" ON public.dataset_items
  FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));

CREATE POLICY "dataset_items_insert_member" ON public.dataset_items
  FOR INSERT TO authenticated
  WITH CHECK (public.is_org_member(organization_id));

CREATE POLICY "dataset_items_delete_member" ON public.dataset_items
  FOR DELETE TO authenticated
  USING (public.is_org_member(organization_id));

COMMENT ON TABLE public.dataset_items IS
  'Individual test case in a dataset. input is jsonb (variables or messages shape).';

-- Now wire eval_results.dataset_item_id (added forward-compatibly in 20260513000000_evals.sql).
-- The column already exists but lacked an FK. Add the FK now so the relationship is enforced.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'eval_results_dataset_item_id_fkey'
      AND table_name = 'eval_results'
  ) THEN
    ALTER TABLE public.eval_results
      ADD CONSTRAINT eval_results_dataset_item_id_fkey
      FOREIGN KEY (dataset_item_id)
      REFERENCES public.dataset_items(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- And give eval_runs.dataset_id a proper FK too.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'eval_runs' AND column_name = 'dataset_id'
  ) THEN
    ALTER TABLE public.eval_runs
      ADD COLUMN dataset_id uuid REFERENCES public.datasets(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_eval_runs_dataset
      ON public.eval_runs (dataset_id)
      WHERE dataset_id IS NOT NULL;
  END IF;
END $$;
