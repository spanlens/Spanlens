-- Migration: internal_alerts queue
--
-- Internal operator-facing alerts queue. Used by automated background checks
-- that detect Spanlens-wide problems (missing model prices, accumulating
-- orphan spans, etc.) and need to surface them to the on-call Spanlens
-- operator BEFORE we wire up a real Slack integration (R-18 / Q1 2027).
--
-- Lifecycle
--   * Inserted by cron handlers running under service_role (RLS bypass).
--   * Surfaced at /admin/alerts to SPANLENS_ADMIN_EMAILS users.
--   * "Resolved" is a soft acknowledgement — the operator clicks Resolve
--     when they've handled the underlying issue. We do not auto-resolve
--     because some alerts (e.g. missing_model_prices) re-fire harmlessly
--     hour-after-hour until the operator fixes the price seed, and an
--     auto-resolve would mask a stuck condition.
--
-- Multi-tenancy
--   No organization_id column. These are internal-operator alerts, never
--   per-org. Org-facing notifications go through the existing
--   notification_channels + alerts pipeline.
--
-- CHECK constraints
--   `kind` enumerates the alert family. Adding a new family is a code-only
--   change once it's in the list — no SQL needed. The initial four:
--
--     missing_model_prices  — R-Q2 (this PR)
--     orphan_spans          — R-14 (Sprint 5-6)
--     fallback_queue_high   — R-22 health metric trigger
--     webhook_backlog       — R-22 health metric trigger
--
--   `severity` is the standard info/warn/error tri-state. We never page on
--   `info`; `warn` shows up in the dashboard; `error` is reserved for cases
--   that need human attention within hours, not days.
--
-- Indexing
--   The dashboard query is "unresolved rows by kind, newest first". The
--   partial index hits exactly that shape and shrinks naturally as old
--   alerts are resolved.

CREATE TABLE internal_alerts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        TEXT NOT NULL CHECK (kind IN (
    'missing_model_prices',
    'orphan_spans',
    'fallback_queue_high',
    'webhook_backlog'
  )),
  severity    TEXT NOT NULL CHECK (severity IN ('info', 'warn', 'error')),
  message     TEXT NOT NULL,
  details     JSONB NOT NULL DEFAULT '{}'::jsonb,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- "Unresolved by kind, newest first" — exact shape of the dashboard query.
CREATE INDEX internal_alerts_unresolved_idx
  ON internal_alerts (kind, created_at DESC)
  WHERE resolved_at IS NULL;

-- Deny-by-default RLS. Server reads/writes via service_role (bypasses RLS);
-- the admin UI goes through /api/v1/admin/alerts (SPANLENS_ADMIN_EMAILS
-- check via requireSystemAdmin middleware). No authenticated-role policies.
ALTER TABLE internal_alerts ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE internal_alerts IS
  'Spanlens operator alerts queue. Inserted by cron jobs, surfaced at /admin/alerts. Replace with Slack once R-18 (OAuth) lands.';
COMMENT ON COLUMN internal_alerts.kind IS
  'Alert family. Adding a new family requires extending the CHECK constraint plus code; do not stuff free-form text here.';
COMMENT ON COLUMN internal_alerts.resolved_at IS
  'Soft acknowledgement — clicked by the operator at /admin/alerts. Not auto-set, since most kinds re-fire benignly until the root cause is fixed.';
