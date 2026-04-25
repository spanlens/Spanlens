-- Onboarding profile data per user.
--
-- Captures the answers to the post-signup survey (use case + role) and
-- doubles as the "has the user finished onboarding?" flag via onboarded_at.
-- The dashboard layout uses this flag to decide whether to show the app or
-- redirect to /onboarding.
--
-- Designed as a separate table (not a column on auth.users) so we can:
--   • iterate on the survey schema without touching auth tables
--   • drop the table during a future product pivot without an auth migration
--   • have RLS policies attached to it independently of Supabase's managed
--     auth schema (which we cannot freely modify).

CREATE TABLE user_profiles (
  user_id        UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

  -- "What are you building?" — chatbot / rag / agent / code_assistant /
  -- internal_tool / other. Free-text stored so we can add new options without
  -- a migration; the API layer validates against an allowlist.
  use_case       TEXT,

  -- "What's your role?" — engineer / product / founder / researcher / other.
  role           TEXT,

  -- Stamped when the user completes (or skips) the survey. Until set, the
  -- dashboard layout sends them to /onboarding. NULL means "still in
  -- onboarding" — a row may exist without onboarded_at if we ever pre-create
  -- profiles for invited users, but right now we only INSERT on completion.
  onboarded_at   TIMESTAMPTZ,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_profiles_onboarded ON user_profiles(onboarded_at)
  WHERE onboarded_at IS NULL;

-- updated_at trigger so any future PATCH to use_case / role bumps the column
-- without the API having to remember.
CREATE OR REPLACE FUNCTION set_user_profiles_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER user_profiles_updated_at
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION set_user_profiles_updated_at();

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Self-only access. Server writes go through supabaseAdmin.
CREATE POLICY "user_profiles_select_own" ON user_profiles
  FOR SELECT USING (user_id = auth.uid());
