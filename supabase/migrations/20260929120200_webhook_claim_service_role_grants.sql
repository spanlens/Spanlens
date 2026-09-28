-- claim_webhook_deliveries() (20260929120000, redefined in 20260929120100) is
-- SECURITY INVOKER, so the role that calls it needs the table privileges its
-- statements use: SELECT and UPDATE on webhook_deliveries, SELECT on webhooks.
--
-- Hosted Supabase grants service_role full table privileges on every public
-- table by default, so production already has them. Some Supabase CLI images
-- do not grant them on tables created by migrations, and there the claim
-- failed with "permission denied for table webhook_deliveries" (CI, running
-- supabase/tests/webhook-claim-smoke.sql). Granting them explicitly makes the
-- function work wherever the schema is installed, including self-hosted
-- databases built from supabase/init.sql.
--
-- Idempotent: GRANT on an existing privilege is a no-op.

GRANT SELECT, UPDATE ON public.webhook_deliveries TO service_role;
GRANT SELECT ON public.webhooks TO service_role;
