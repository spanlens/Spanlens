-- HIGH #6: 5 tables have RLS enabled but zero policies. service_role
-- bypasses RLS so the server still works, but the missing explicit
-- intent triggers `rls_enabled_no_policy` lint and risks regression if
-- someone later mistakenly grants table access to anon/authenticated.
--
-- Add a RESTRICTIVE deny-all policy on each so anon/authenticated get
-- a clear "denied" instead of relying on absence-of-policy semantics.
--
-- All real callers use supabaseAdmin (service_role) — verified:
--   waitlist                       — apps/server/src/api/waitlist.ts
--   requests_fallback              — apps/server/src/lib/logger.ts + fallback-replay.ts
--   rate_limit_buckets             — apps/server/src/lib/rate-limit.ts (supabaseAdmin)
--   billing_downgrade_notifications — apps/server/src/lib/billing-downgrade.ts
--   recommendation_notifications   — apps/server/src/lib/recommendation-notify.ts

CREATE POLICY waitlist_deny_public ON public.waitlist
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

CREATE POLICY requests_fallback_deny_public ON public.requests_fallback
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

CREATE POLICY rate_limit_buckets_deny_public ON public.rate_limit_buckets
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

CREATE POLICY billing_downgrade_notifications_deny_public ON public.billing_downgrade_notifications
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

CREATE POLICY recommendation_notifications_deny_public ON public.recommendation_notifications
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
