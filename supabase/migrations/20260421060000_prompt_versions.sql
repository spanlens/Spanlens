-- Phase 3A — prompt versioning (foundation for A/B comparison and model recommendation)
--
-- A "prompt" is identified by (organization_id, project_id, name). Each name has
-- many versions — each version is an immutable snapshot of `content` + `variables`.
-- Requests that use a prompt reference the specific version via requests.prompt_version_id.

CREATE TABLE IF NOT EXISTS public.prompt_versions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id    uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  name          text NOT NULL,
  version       integer NOT NULL,
  content       text NOT NULL,
  variables     jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{ name, description, required }]
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name, version)
);

CREATE INDEX IF NOT EXISTS idx_prompt_versions_org_name
  ON public.prompt_versions (organization_id, name, version DESC);
CREATE INDEX IF NOT EXISTS idx_prompt_versions_project
  ON public.prompt_versions (project_id)
  WHERE project_id IS NOT NULL;

-- Link requests ↔ prompt_versions so A/B comparison can aggregate request metrics per version
ALTER TABLE public.requests
  ADD COLUMN IF NOT EXISTS prompt_version_id uuid REFERENCES public.prompt_versions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_requests_prompt_version
  ON public.requests (prompt_version_id)
  WHERE prompt_version_id IS NOT NULL;

-- Row-level security: org members SELECT; INSERT via authenticated authJwt only (not anon)
ALTER TABLE public.prompt_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "prompt_versions_select_member" ON public.prompt_versions
  FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));

CREATE POLICY "prompt_versions_insert_member" ON public.prompt_versions
  FOR INSERT TO authenticated
  WITH CHECK (public.is_org_member(organization_id));

CREATE POLICY "prompt_versions_delete_member" ON public.prompt_versions
  FOR DELETE TO authenticated
  USING (public.is_org_member(organization_id));

COMMENT ON TABLE public.prompt_versions IS
  'Immutable prompt snapshots. New version = new row. Requests may reference one version via requests.prompt_version_id.';
