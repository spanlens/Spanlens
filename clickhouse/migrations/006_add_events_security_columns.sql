-- 006_add_events_security_columns.sql
-- Phase 5.1 Stage 3 — fill the column gap between `events` and `requests`
-- so the stats pipeline can return real security/truncation values instead
-- of the literal placeholders the events_as_requests view falls back to.
--
-- Adds the four columns the legacy `requests` table carries but `events`
-- never did:
--
--   • flags                LowCardinality(String) DEFAULT '[]'
--     Comma-separated PII / prompt-injection markers from the proxy.
--   • response_flags       LowCardinality(String) DEFAULT '{}'
--     Provider safety metadata (OpenAI's `flagged` etc).
--   • has_security_flags   Bool DEFAULT false
--     Pre-computed boolean: any flags set → 1. Drives the
--     SecuritySummary aggregation and the "security badge" filter.
--   • truncated            UInt8 DEFAULT 0
--     1 when the stream deadline (290s) cut the response short — see
--     CLAUDE.md gotcha #11.
--
-- WHY add these now, not in the original 004:
--   Stage 1 dual-write shipped before the column gap was visible. Stage
--   3 surfaced it: the events_as_requests view had to hard-code
--   '[]' / '{}' / 0 / 0 to keep the SQL shape compatible, which masks
--   real flag counts and truncation rates on the dashboard once the
--   read switch is on.
--
-- BACKFILL: existing events rows default to the empty-state values
-- above. The next dual-write (events-writer.ts) will populate the
-- columns for new rows; the historical backfill picks them up on the
-- next backfill-events-from-requests cron run (the SELECT side of the
-- code-path migration needs a follow-up to thread these columns
-- through — done in a separate PR so the schema change can deploy
-- in isolation).
--
-- IDEMPOTENT (CLAUDE.md DB rule): ADD COLUMN IF NOT EXISTS so the
-- migration is safe to apply twice. CH MergeTree adds the column
-- lazily — no rewrite of existing parts.

ALTER TABLE events
    ADD COLUMN IF NOT EXISTS flags              LowCardinality(String) DEFAULT '[]';

ALTER TABLE events
    ADD COLUMN IF NOT EXISTS response_flags     LowCardinality(String) DEFAULT '{}';

ALTER TABLE events
    ADD COLUMN IF NOT EXISTS has_security_flags Bool                   DEFAULT false;

ALTER TABLE events
    ADD COLUMN IF NOT EXISTS truncated          UInt8                  DEFAULT 0;
