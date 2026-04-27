-- Waitlist table for collecting alpha/early-access sign-ups
-- Status flow: pending → invited (admin sends invite) | rejected

CREATE TABLE IF NOT EXISTS waitlist (
  id         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  email      TEXT        NOT NULL,
  name       TEXT,
  company    TEXT,
  use_case   TEXT,
  status     TEXT        NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'invited', 'rejected')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(email)
);

ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;

-- Only service_role can read (admin dashboard via supabaseAdmin)
-- No anon SELECT or INSERT policies — inserts go through the server API
