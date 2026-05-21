-- CRITICAL #2: webhook_deliveries had INSERT policy WITH CHECK (true) for
-- public role — defense-in-depth violation flagged by rls_policy_always_true.
--
-- All real INSERTs come from apps/server/src/lib/webhook-dispatch.ts via
-- supabaseAdmin (service_role), which bypasses RLS. So we DROP the policy
-- entirely — anon/authenticated had no business inserting delivery rows.
--
-- SELECT policy stays (used by webhooks dashboard via authenticated client).

DROP POLICY IF EXISTS webhook_deliveries_insert_service ON public.webhook_deliveries;
