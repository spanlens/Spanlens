-- Security blocking + alert settings.
--
-- Three new capabilities:
--   1. Per-project request blocking — proxy returns 422 when injection detected
--      and blocking is enabled for that project.
--   2. Response scanning — requests.response_flags stores flags found in the
--      LLM's reply (PII in output, etc.).
--   3. Security alert emails — when any flag is detected, email org admins
--      (rate-limited to 1 email per 5 minutes per org via last_security_alert_at).

-- ── projects: injection blocking toggle ───────────────────────────────────────
ALTER TABLE projects
  ADD COLUMN security_block_enabled BOOLEAN NOT NULL DEFAULT false;

-- ── requests: response-side security flags ────────────────────────────────────
ALTER TABLE requests
  ADD COLUMN response_flags JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Generated column — true when either request OR response has flags.
-- Used as a fast, index-friendly filter for the flagged-requests list.
ALTER TABLE requests
  ADD COLUMN has_security_flags BOOLEAN GENERATED ALWAYS AS (
    (flags != '[]'::jsonb OR response_flags != '[]'::jsonb)
  ) STORED;

CREATE INDEX idx_requests_has_security_flags
  ON requests (organization_id, created_at DESC)
  WHERE has_security_flags = true;

-- ── organizations: alert settings ────────────────────────────────────────────
ALTER TABLE organizations
  ADD COLUMN security_alert_enabled   BOOLEAN   NOT NULL DEFAULT false,
  ADD COLUMN last_security_alert_at   TIMESTAMPTZ;
