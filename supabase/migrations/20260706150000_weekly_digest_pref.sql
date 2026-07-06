-- Migration: weekly_digest_pref
--
-- Adds the per-user opt-out toggle for the weekly usage digest email
-- (Monday 09:00 UTC cron /cron/weekly-digest, lib/weekly-digest.ts).
--
-- Defaults to true so every existing admin is opted in on deploy, matching
-- the convention of the other user_notification_prefs columns (see
-- 20260529000100_user_notification_prefs.sql). The digest sender resolves
-- recipients through lib/digest-recipients.ts, which excludes only users
-- who explicitly set this to false. Distinct from security_alert_emails on
-- purpose: opting out of a usage summary must not silence security alerts,
-- and vice versa.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, safe to re-run.

ALTER TABLE user_notification_prefs
  ADD COLUMN IF NOT EXISTS weekly_digest_emails BOOLEAN NOT NULL DEFAULT true;
