-- Migration: register_orphan_span_link_v3
--
-- Supersedes 20260609150000_register_orphan_span_link.sql which was
-- broken: the original INSERT supplied only (name, status) but the
-- background_migrations table has description TEXT NOT NULL (see
-- 20260608030000_background_migrations.sql line 36). Postgres rolled
-- back the whole transaction on every push, so the migration never
-- committed in production. The "Deploy production (DB + server)"
-- workflow failed on every push for 4 consecutive PRs (#273, #276,
-- #277, #278) and the orphan-span-link background_migrations row was
-- never inserted in production. The R-14 watchdog therefore had
-- nothing to monitor and its 7-day verification window never started.
--
-- Recovery procedure (executed before this PR):
--   1. The broken migration's version (20260609150000) was manually
--      marked as applied in supabase_migrations.schema_migrations via
--      supabase MCP. This is the "broken migration recovery" pattern
--      documented in CLAUDE.md. The fake-apply row stores a comment
--      pointing at this file as the supersede target.
--   2. This new migration (timestamp 20260609170000) performs the
--      INSERT correctly. Idempotent via ON CONFLICT so dev / CI runs
--      that already inserted the row (e.g. seeded test environments)
--      stay a no-op.
--
-- After this migration applies in production:
--   - background_migrations row for orphan-span-link exists
--   - /cron/run-background-migrations picks the job up within 5 minutes
--   - /cron/detect-orphan-spans watchdog begins its 7-day clock
--   - R-14 Sprint 6 ops verification (OTLP p95 30%↓ + orphan=0) starts

INSERT INTO background_migrations (name, description, status)
VALUES (
  'orphan-span-link',
  'R-14: resolve OTLP external_parent_span_id to parent_span_id UUID outside the request path. Chunked scan of the spans_orphan_external_parent_idx partial index in 500-row batches.',
  'pending'
)
ON CONFLICT (name) DO NOTHING;
