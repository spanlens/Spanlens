-- 002_add_truncated.sql
-- Adds the `truncated` flag set when Spanlens gracefully closes a stream that
-- was approaching its Vercel function deadline (default 290s on a 300s plan).
--
-- WHY: Before this column, deadline-bound requests either timed out hard
-- (function killed at the Vercel limit) with NO row written, or completed
-- but with possibly partial token counts and no signal to consumers. This
-- column gives the dashboard a way to filter and the SDK a way to detect.
--
-- BACKFILL: existing rows default to 0 (not truncated). No rewrite needed —
-- CH's MergeTree handles DEFAULT columns lazily on read.
--
-- IDEMPOTENT (CLAUDE.md DB rule): IF NOT EXISTS for ALTER. CH treats this as
-- a metadata-only change; safe to apply against a populated table.

ALTER TABLE requests
    ADD COLUMN IF NOT EXISTS truncated UInt8 DEFAULT 0;
