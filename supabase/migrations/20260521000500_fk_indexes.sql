-- HIGH #5: Add btree indexes on every FK column that the lint flagged as
-- unindexed (39 total). Most matter because they are `organization_id` —
-- the multi-tenant isolation column queried on every dashboard list.
--
-- Plain `CREATE INDEX` (not CONCURRENTLY) because Supabase migrations
-- wrap each file in a transaction, and CONCURRENTLY cannot run there.
-- All affected tables hold ≤ a few hundred rows in production right
-- now, so the AccessExclusiveLock per CREATE INDEX completes in
-- milliseconds. Re-evaluate CONCURRENTLY if any table grows past 100k.

-- organization scoping (highest priority — every dashboard read filters on this)
CREATE INDEX IF NOT EXISTS idx_projects_organization_id           ON public.projects (organization_id);
CREATE INDEX IF NOT EXISTS idx_provider_keys_organization_id      ON public.provider_keys (organization_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_organization_id         ON public.audit_logs (organization_id);
CREATE INDEX IF NOT EXISTS idx_spans_organization_id              ON public.spans (organization_id);
CREATE INDEX IF NOT EXISTS idx_alert_deliveries_organization_id   ON public.alert_deliveries (organization_id);
CREATE INDEX IF NOT EXISTS idx_saved_filters_organization_id      ON public.saved_filters (organization_id);
CREATE INDEX IF NOT EXISTS idx_eval_runs_organization_id          ON public.eval_runs (organization_id);
CREATE INDEX IF NOT EXISTS idx_eval_results_organization_id       ON public.eval_results (organization_id);
CREATE INDEX IF NOT EXISTS idx_dataset_items_organization_id      ON public.dataset_items (organization_id);
CREATE INDEX IF NOT EXISTS idx_experiment_results_organization_id ON public.experiment_results (organization_id);

-- project scoping
CREATE INDEX IF NOT EXISTS idx_api_keys_project_id              ON public.api_keys (project_id);
CREATE INDEX IF NOT EXISTS idx_usage_daily_project_id           ON public.usage_daily (project_id);
CREATE INDEX IF NOT EXISTS idx_anomaly_acks_project_id          ON public.anomaly_acks (project_id);
CREATE INDEX IF NOT EXISTS idx_prompt_ab_exp_project_id         ON public.prompt_ab_experiments (project_id);

-- user / actor FK (CASCADE on user delete needs the index for fast cleanup)
CREATE INDEX IF NOT EXISTS idx_organizations_owner_id          ON public.organizations (owner_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id              ON public.audit_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_prompt_versions_created_by      ON public.prompt_versions (created_by);
CREATE INDEX IF NOT EXISTS idx_anomaly_acks_acknowledged_by    ON public.anomaly_acks (acknowledged_by);
CREATE INDEX IF NOT EXISTS idx_org_members_invited_by          ON public.org_members (invited_by);
CREATE INDEX IF NOT EXISTS idx_org_invitations_invited_by      ON public.org_invitations (invited_by);
CREATE INDEX IF NOT EXISTS idx_prompt_ab_exp_created_by        ON public.prompt_ab_experiments (created_by);
CREATE INDEX IF NOT EXISTS idx_evaluators_created_by           ON public.evaluators (created_by);
CREATE INDEX IF NOT EXISTS idx_eval_runs_created_by            ON public.eval_runs (created_by);
CREATE INDEX IF NOT EXISTS idx_datasets_created_by             ON public.datasets (created_by);
CREATE INDEX IF NOT EXISTS idx_experiments_created_by          ON public.experiments (created_by);
CREATE INDEX IF NOT EXISTS idx_human_evals_reviewer_id         ON public.human_evals (reviewer_id);
CREATE INDEX IF NOT EXISTS idx_model_price_history_changed_by  ON public.model_price_history (changed_by);

-- cross-entity FK (needed for cascading deletes + JOIN performance)
CREATE INDEX IF NOT EXISTS idx_traces_api_key_id                ON public.traces (api_key_id);
CREATE INDEX IF NOT EXISTS idx_alert_deliveries_channel_id      ON public.alert_deliveries (channel_id);
CREATE INDEX IF NOT EXISTS idx_prompt_ab_exp_version_a_id       ON public.prompt_ab_experiments (version_a_id);
CREATE INDEX IF NOT EXISTS idx_prompt_ab_exp_version_b_id       ON public.prompt_ab_experiments (version_b_id);
CREATE INDEX IF NOT EXISTS idx_prompt_ab_exp_winner_version_id  ON public.prompt_ab_experiments (winner_version_id);
CREATE INDEX IF NOT EXISTS idx_eval_results_dataset_item_id     ON public.eval_results (dataset_item_id);
CREATE INDEX IF NOT EXISTS idx_experiments_dataset_id           ON public.experiments (dataset_id);
CREATE INDEX IF NOT EXISTS idx_experiments_evaluator_id         ON public.experiments (evaluator_id);
CREATE INDEX IF NOT EXISTS idx_experiments_version_a_id         ON public.experiments (version_a_id);
CREATE INDEX IF NOT EXISTS idx_experiments_version_b_id         ON public.experiments (version_b_id);
CREATE INDEX IF NOT EXISTS idx_experiment_results_dataset_item_id ON public.experiment_results (dataset_item_id);
CREATE INDEX IF NOT EXISTS idx_model_price_history_model_price_id ON public.model_price_history (model_price_id);
