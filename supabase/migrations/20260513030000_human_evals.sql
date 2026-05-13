-- Human evals: manual scoring of individual requests by team members.
--
-- Complements LLM-as-judge (eval_results) by capturing human ground truth.
-- The aggregate over LLM vs human scores tells you whether your LLM judge
-- is actually trustworthy.
--
-- Score is stored normalized to 0..1 to match eval_results. raw_score holds
-- the UI value (e.g. 1–5 stars) for re-display.

CREATE TABLE IF NOT EXISTS public.human_evals (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  request_id         uuid        NOT NULL REFERENCES public.requests(id) ON DELETE CASCADE,
  -- Denormalized for fast filtering / correlation queries by prompt_version.
  prompt_version_id  uuid        REFERENCES public.prompt_versions(id) ON DELETE SET NULL,
  reviewer_id        uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Normalized 0..1 — same scale as eval_results.score so correlation is direct.
  score              numeric     NOT NULL CHECK (score >= 0 AND score <= 1),
  -- Raw UI value (e.g. 1..5 stars) for re-rendering.
  raw_score          numeric,
  comment            text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  -- One reviewer scores each request at most once. Update overwrites prior.
  UNIQUE (request_id, reviewer_id)
);

CREATE INDEX IF NOT EXISTS idx_human_evals_org
  ON public.human_evals (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_human_evals_prompt_version
  ON public.human_evals (prompt_version_id)
  WHERE prompt_version_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_human_evals_request
  ON public.human_evals (request_id);

ALTER TABLE public.human_evals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "human_evals_select_member" ON public.human_evals
  FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));

CREATE POLICY "human_evals_insert_member" ON public.human_evals
  FOR INSERT TO authenticated
  WITH CHECK (public.is_org_member(organization_id));

CREATE POLICY "human_evals_update_own" ON public.human_evals
  FOR UPDATE TO authenticated
  USING (reviewer_id = auth.uid() AND public.is_org_member(organization_id));

CREATE POLICY "human_evals_delete_own" ON public.human_evals
  FOR DELETE TO authenticated
  USING (reviewer_id = auth.uid() AND public.is_org_member(organization_id));

COMMENT ON TABLE public.human_evals IS
  'Per-request human scoring. Score normalized 0..1 to match eval_results for direct correlation.';

-- Auto-update updated_at on row changes.
CREATE OR REPLACE FUNCTION public.human_evals_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_human_evals_updated_at ON public.human_evals;
CREATE TRIGGER trg_human_evals_updated_at
  BEFORE UPDATE ON public.human_evals
  FOR EACH ROW
  EXECUTE FUNCTION public.human_evals_set_updated_at();
