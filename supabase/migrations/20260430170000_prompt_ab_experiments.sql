-- A/B experiment tracking for prompt versions.
--
-- An experiment compares two versions of the same prompt (version_a vs version_b)
-- by routing a fraction of @latest traffic to each. One org can have at most one
-- running experiment per prompt name at a time (enforced by partial unique index).
--
-- Lifecycle: running → concluded | stopped
--   concluded = experiment ran its course, winner decided
--   stopped   = manually ended before conclusion

CREATE TABLE IF NOT EXISTS public.prompt_ab_experiments (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id       uuid        REFERENCES public.projects(id) ON DELETE SET NULL,
  prompt_name      text        NOT NULL,
  version_a_id     uuid        NOT NULL REFERENCES public.prompt_versions(id) ON DELETE RESTRICT,
  version_b_id     uuid        NOT NULL REFERENCES public.prompt_versions(id) ON DELETE RESTRICT,
  -- traffic_split = % of requests routed to version_a (0-100). Remaining goes to B.
  traffic_split    smallint    NOT NULL DEFAULT 50 CHECK (traffic_split BETWEEN 1 AND 99),
  status           text        NOT NULL DEFAULT 'running'
                               CHECK (status IN ('running', 'concluded', 'stopped')),
  started_at       timestamptz NOT NULL DEFAULT now(),
  ends_at          timestamptz,          -- optional planned end date
  concluded_at     timestamptz,
  winner_version_id uuid       REFERENCES public.prompt_versions(id) ON DELETE SET NULL,
  created_by       uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT version_a_ne_b CHECK (version_a_id <> version_b_id)
);

-- Only one running experiment per (org, prompt_name) at a time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_prompt_ab_exp_unique_running
  ON public.prompt_ab_experiments (organization_id, prompt_name)
  WHERE status = 'running';

-- Lookup index for traffic routing (hot path in resolve-prompt-version).
CREATE INDEX IF NOT EXISTS idx_prompt_ab_exp_org_name_status
  ON public.prompt_ab_experiments (organization_id, prompt_name, status);

-- RLS
ALTER TABLE public.prompt_ab_experiments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "prompt_ab_exp_select_member" ON public.prompt_ab_experiments
  FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));

CREATE POLICY "prompt_ab_exp_insert_member" ON public.prompt_ab_experiments
  FOR INSERT TO authenticated
  WITH CHECK (public.is_org_member(organization_id));

CREATE POLICY "prompt_ab_exp_update_member" ON public.prompt_ab_experiments
  FOR UPDATE TO authenticated
  USING (public.is_org_member(organization_id));

COMMENT ON TABLE public.prompt_ab_experiments IS
  'Tracks A/B experiments comparing two prompt versions. Traffic split routes @latest requests.';
