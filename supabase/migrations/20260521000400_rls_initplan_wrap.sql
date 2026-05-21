-- HIGH #4: Wrap `auth.uid()` in `(select auth.uid())` so Postgres caches the
-- result as an InitPlan instead of re-evaluating once per row. Performance
-- impact grows linearly with table size — fix is invisible today but
-- critical once any of these tables holds 100k+ rows.
--
-- Using ALTER POLICY (no DROP/CREATE) keeps the policy continuously in
-- effect — there is no window where the table becomes unprotected.
--
-- Affected: 16 policies flagged by `auth_rls_initplan` lint.

-- organizations
ALTER POLICY org_select ON public.organizations
  USING (owner_id = (select auth.uid()));
ALTER POLICY org_insert ON public.organizations
  WITH CHECK (owner_id = (select auth.uid()));
ALTER POLICY org_update ON public.organizations
  USING (owner_id = (select auth.uid()))
  WITH CHECK (owner_id = (select auth.uid()));

-- attn_dismissals
ALTER POLICY attn_dismissals_select_own ON public.attn_dismissals
  USING (user_id = (select auth.uid()));
ALTER POLICY attn_dismissals_insert_own ON public.attn_dismissals
  WITH CHECK ((user_id = (select auth.uid())) AND is_org_member(organization_id));
ALTER POLICY attn_dismissals_delete_own ON public.attn_dismissals
  USING (user_id = (select auth.uid()));

-- saved_filters
ALTER POLICY saved_filters_select ON public.saved_filters
  USING (user_id = (select auth.uid()));
ALTER POLICY saved_filters_insert ON public.saved_filters
  WITH CHECK (user_id = (select auth.uid()));
ALTER POLICY saved_filters_delete ON public.saved_filters
  USING (user_id = (select auth.uid()));

-- org_members  (NOTE: self-reference avoidance per gotcha #14)
ALTER POLICY org_members_select_self ON public.org_members
  USING (user_id = (select auth.uid()));

-- user_profiles
ALTER POLICY user_profiles_select_own ON public.user_profiles
  USING (user_id = (select auth.uid()));

-- human_evals (only the two policies with direct auth.uid())
ALTER POLICY human_evals_update_own ON public.human_evals
  USING ((reviewer_id = (select auth.uid())) AND is_org_member(organization_id));
ALTER POLICY human_evals_delete_own ON public.human_evals
  USING ((reviewer_id = (select auth.uid())) AND is_org_member(organization_id));

-- user_consents
ALTER POLICY user_consents_select_own ON public.user_consents
  USING (user_id = (select auth.uid()));

-- recommendation_applications
ALTER POLICY "users can select their own applications" ON public.recommendation_applications
  USING (user_id = (select auth.uid()));

-- model_price_history
ALTER POLICY model_price_history_admin_select ON public.model_price_history
  USING (EXISTS (
    SELECT 1 FROM org_members om
    WHERE om.user_id = (select auth.uid()) AND om.role = 'admin'::org_role
  ));
