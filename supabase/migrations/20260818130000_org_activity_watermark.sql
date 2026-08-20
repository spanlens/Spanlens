-- org_activity — per-organization "when did we last log a request" watermark.
--
-- Exists purely to keep crons off ClickHouse. ClickHouse Cloud bills compute
-- by wall-clock uptime and suspends only after 15 quiet minutes, so a cron
-- that queries it on a sub-15-minute rhythm pins the service awake forever
-- regardless of how little data it reads. Measured 2026-08-18: 1152 CH
-- queries/day against ~8 real customer requests/day, $8.805/day compute.
--
-- Most of those queries could not have returned anything interesting: they
-- asked ClickHouse about organizations that had sent no traffic at all. This
-- table lets the crons answer "is there anything new for this org?" from
-- Postgres, which is already awake, and skip ClickHouse entirely when the
-- answer is no.
--
-- Written by lib/logger.ts on a successful `requests` insert; read by
-- lib/org-activity.ts. Deliberately one row per org rather than an append
-- log — the only question anyone asks is "how recent is the newest request",
-- and an UPSERT keeps this table at organization scale forever.

CREATE TABLE IF NOT EXISTS public.org_activity (
  organization_id  uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  last_request_at  timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Crons scan "which orgs were active since T", never a single org by id.
CREATE INDEX IF NOT EXISTS org_activity_last_request_at_idx
  ON public.org_activity (last_request_at DESC);

ALTER TABLE public.org_activity ENABLE ROW LEVEL SECURITY;

-- No policies: every reader and writer is the server on the service role,
-- which bypasses RLS. RLS stays on so a future anon-key reader fails closed
-- rather than reading every tenant's activity.

-- Backfill from usage_daily so the gates are accurate on the very first run
-- instead of treating every existing org as silent. Day granularity is all
-- usage_daily has; rounding to the end of the day is the conservative
-- direction (an org looks slightly more recently active than it was, so a
-- cron runs when it might have skipped — never the reverse).
--
-- Orgs with no usage_daily rows intentionally get no row here: they have
-- never sent a request, and the gates should skip them.
INSERT INTO public.org_activity (organization_id, last_request_at)
SELECT organization_id, (max(date) + interval '1 day' - interval '1 second')::timestamptz
FROM public.usage_daily
GROUP BY organization_id
ON CONFLICT (organization_id) DO NOTHING;
