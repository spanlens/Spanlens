-- Migration: register_orphan_span_link
--
-- R-14 (Sprint 6) — production registration of the orphan-span-link
-- background migration. PR #270 shipped the registry entry + chunked
-- runner; this migration kicks off the actual job by INSERTing the
-- row that the 5-minute cron polls for.
--
-- Idempotency
--   ON CONFLICT (name) DO NOTHING — re-running this migration on a DB
--   that already has the row is a no-op. The job's status field is
--   left alone so an operator who pauses the job ('paused') doesn't
--   get it re-set to 'pending' by a redeploy.
--
-- Behaviour on a fresh DB (dev / CI)
--   The job runs immediately on the next cron tick. orphan-span-link
--   is safe to run against a brand-new spans table — the orphan
--   SELECT returns zero rows and runChunk returns done:true, so it
--   completes in one tick with no side effects. Dev devs do not need
--   to do anything; the row is harmless.
--
-- After production deploy
--   /cron/run-background-migrations picks the row up within 5 minutes.
--   /cron/detect-orphan-spans (hourly at xx:17) provides the watchdog
--   alert if the job stalls and orphans accumulate above 100.
--
-- See:
--   apps/server/src/lib/background-migrations/registry/migrations/orphan-span-link.ts
--   apps/server/src/api/cron.ts (/cron/detect-orphan-spans)

INSERT INTO background_migrations (name, status)
VALUES ('orphan-span-link', 'pending')
ON CONFLICT (name) DO NOTHING;
