-- P2-10: auto-run an evaluator when a new version of its prompt is created
-- (the "golden regression suite"). A just-created version has no production
-- traffic, so the auto-run is a DATASET run — it generates responses for a
-- golden dataset with a chosen model, then scores them. The dataset + run
-- model are therefore evaluator-specific, so the opt-in lives on the
-- evaluator.
--
-- All additive + nullable (gotcha #25). The consistency CHECK makes it
-- impossible to enable auto-run without the dataset / provider / model it
-- needs — closing the "app allows it, DB stores a half-config" gap that the
-- untyped client otherwise leaves open.

ALTER TABLE evaluators
  ADD COLUMN IF NOT EXISTS auto_run_on_version boolean NOT NULL DEFAULT false;

ALTER TABLE evaluators
  ADD COLUMN IF NOT EXISTS auto_run_dataset_id uuid REFERENCES public.datasets(id) ON DELETE SET NULL;

ALTER TABLE evaluators
  ADD COLUMN IF NOT EXISTS auto_run_provider text;

ALTER TABLE evaluators
  ADD COLUMN IF NOT EXISTS auto_run_model text;

ALTER TABLE evaluators
  ADD COLUMN IF NOT EXISTS auto_run_sample_size int;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.evaluators'::regclass
      AND conname = 'evaluators_auto_run_requires_config'
  ) THEN
    ALTER TABLE evaluators ADD CONSTRAINT evaluators_auto_run_requires_config CHECK (
      auto_run_on_version = false
      OR (auto_run_dataset_id IS NOT NULL AND auto_run_provider IS NOT NULL AND auto_run_model IS NOT NULL)
    );
  END IF;
END $$;
