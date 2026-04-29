-- Migration: add project_id + surrogate PK to anomaly_acks
-- Enables per-project ack isolation: org-wide acks use project_id IS NULL.
-- NULLS NOT DISTINCT makes (org, NULL, provider, model, kind) unique.

ALTER TABLE anomaly_acks
  ADD COLUMN id UUID NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN project_id UUID REFERENCES projects(id) ON DELETE CASCADE;

-- Existing rows retain project_id = NULL (treated as org-wide acks).

-- Replace composite natural PK with surrogate PK.
ALTER TABLE anomaly_acks DROP CONSTRAINT anomaly_acks_pkey;
ALTER TABLE anomaly_acks ADD PRIMARY KEY (id);

-- Unique constraint — NULLS NOT DISTINCT so two org-wide acks for the same
-- (provider, model, kind) still conflict even though project_id IS NULL.
CREATE UNIQUE INDEX anomaly_acks_unique_idx
  ON anomaly_acks (organization_id, project_id, provider, model, kind)
  NULLS NOT DISTINCT;
