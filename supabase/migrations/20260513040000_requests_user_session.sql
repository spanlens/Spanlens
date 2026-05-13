-- Add user_id / session_id to requests for end-user attribution.
--
-- Populated from the x-spanlens-user / x-spanlens-session headers at proxy time.
-- Both are text (not FK) — these are the CUSTOMER's user IDs, not ours.

ALTER TABLE public.requests ADD COLUMN IF NOT EXISTS user_id    text;
ALTER TABLE public.requests ADD COLUMN IF NOT EXISTS session_id text;

CREATE INDEX IF NOT EXISTS idx_requests_user_id
  ON public.requests (organization_id, user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_requests_session_id
  ON public.requests (organization_id, session_id, created_at DESC)
  WHERE session_id IS NOT NULL;

COMMENT ON COLUMN public.requests.user_id    IS 'Customer-supplied end-user ID via x-spanlens-user header.';
COMMENT ON COLUMN public.requests.session_id IS 'Customer-supplied session ID via x-spanlens-session header.';
