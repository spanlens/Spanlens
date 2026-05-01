-- Add is_archived flag to prompt_versions.
-- Archived versions are hidden from the default list view but not deleted.

ALTER TABLE public.prompt_versions
  ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false;

-- Index to efficiently query non-archived versions (the common case)
CREATE INDEX IF NOT EXISTS idx_prompt_versions_not_archived
  ON public.prompt_versions (organization_id, name)
  WHERE is_archived = false;

COMMENT ON COLUMN public.prompt_versions.is_archived IS
  'When true the version is hidden from default list views but not deleted. Reversible.';
