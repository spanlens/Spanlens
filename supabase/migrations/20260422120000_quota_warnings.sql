-- Migration: quota_warnings
-- Track when each organization was last warned about quota usage crossing
-- 80% / 100% in the current calendar month. Used by the
-- cron-quota-warnings job to avoid duplicate emails.
--
-- Reset logic is implicit: the cron compares `*_sent_at` against the start
-- of the current UTC calendar month — stale timestamps (from a previous
-- month) are treated as "not yet sent this period" without needing an
-- explicit reset trigger.

ALTER TABLE organizations
  ADD COLUMN quota_warning_80_sent_at  TIMESTAMPTZ,
  ADD COLUMN quota_warning_100_sent_at TIMESTAMPTZ;

-- Index helps the cron job filter eligible orgs quickly when the table grows.
CREATE INDEX organizations_quota_warning_idx
  ON organizations (quota_warning_100_sent_at, quota_warning_80_sent_at);
