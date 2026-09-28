-- merge_span_metadata(): shallow-merge a patch into spans.metadata in one
-- statement.
--
-- PATCH /ingest/spans/:id used to overwrite the whole metadata column. The JS
-- and Python SDKs send the caller's metadata (tenant ids and similar) on the
-- span POST and a provider/model tag on the closing PATCH, so every successful
-- span lost the caller's keys. The ingest handler now calls this function
-- instead: `metadata || patch` keeps existing keys and lets the patch win on
-- conflicts, and doing it inside one UPDATE means two concurrent patches
-- cannot overwrite each other's keys the way a read-merge-write would.
--
-- Scoped by organization_id as well as id, the same way every ingest write is,
-- so an API key can only ever touch spans of its own organization.
--
-- Returns true when a span matched, false when none did (the caller answers
-- 404). A stored value that is not an object (NULL, or an array written by an
-- old client) is replaced by the patch, since there is nothing to merge into.
--
-- Additive and idempotent: CREATE OR REPLACE, grants re-applied every run.

CREATE OR REPLACE FUNCTION public.merge_span_metadata(
  p_span_id         uuid,
  p_organization_id uuid,
  p_patch           jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'merge_span_metadata: p_patch must be a JSON object'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.spans
     SET metadata = CASE
                      WHEN jsonb_typeof(metadata) = 'object' THEN metadata || p_patch
                      ELSE p_patch
                    END
   WHERE id = p_span_id
     AND organization_id = p_organization_id;

  RETURN FOUND;
END;
$$;

COMMENT ON FUNCTION public.merge_span_metadata(uuid, uuid, jsonb) IS
  'Shallow-merges p_patch into spans.metadata (patch keys win) for one span of one organization. Returns false when no span matched. Called by PATCH /ingest/spans/:id through the service role.';

-- Server-only: the ingest router calls it with the service role. anon and
-- authenticated get nothing, so the function is not a write path around RLS
-- for dashboard sessions.
REVOKE ALL ON FUNCTION public.merge_span_metadata(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_span_metadata(uuid, uuid, jsonb) TO service_role;
