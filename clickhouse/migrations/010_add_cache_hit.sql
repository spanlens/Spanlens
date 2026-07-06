-- 010_add_cache_hit.sql
-- Adds the `cache_hit` flag set when a proxy response was served from the
-- opt-in exact-match response cache (x-spanlens-cache header) instead of
-- calling the upstream provider.
--
-- WHY: cached hits are logged with the ORIGINAL token counts and model but
-- cost_usd = 0 (nothing was billed by the provider). Without this flag those
-- rows are indistinguishable from genuinely-free requests, so cache savings
-- ("what would these tokens have cost?") cannot be computed later.
--
-- BACKFILL: existing rows default to 0 (not a cache hit). No rewrite needed —
-- CH's MergeTree handles DEFAULT columns lazily on read.
--
-- ⚠️ DEPLOY ORDER (CLAUDE.md gotcha #21): apply this to production ClickHouse
-- MANUALLY (Cloud SQL console) BEFORE the code that writes cache_hit deploys.
-- input_format_skip_unknown_fields=1 protects the window (rows insert, the
-- flag is silently dropped), but the flag data is lost until the column exists.
--
-- IDEMPOTENT (CLAUDE.md DB rule): IF NOT EXISTS for ALTER. CH treats this as
-- a metadata-only change; safe to apply against a populated table.

ALTER TABLE requests
    ADD COLUMN IF NOT EXISTS cache_hit UInt8 DEFAULT 0;
