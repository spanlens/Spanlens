-- Atomic per-week claim for the weekly digest cron. Both schedulers
-- (Vercel cron + GH Actions backup, gotcha #32) can fire around the same
-- time; the cron_job_runs "success this week" lookup only closes the race
-- after the whole job finishes, which can take minutes across many orgs.
-- A primary-key INSERT claim closes it before the first email is sent:
-- exactly one runner wins the 23505 race for a given week_start.
CREATE TABLE IF NOT EXISTS weekly_digest_runs (
  week_start  DATE        PRIMARY KEY,
  claimed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE weekly_digest_runs ENABLE ROW LEVEL SECURITY;
-- Server-only via service_role (supabaseAdmin); no client policies.
