-- Migration: user_notification_prefs
--
-- Per-USER notification preferences (account-level), distinct from the
-- org-level notification_channels which decide WHERE alerts physically go.
-- This table decides what reaches a given person.
--
-- Boundary recap:
--   notification_channels  (org)   — Slack/Discord/email endpoints, shared
--   user_notification_prefs (user) — "what email does THIS person consent to"
--
-- All three columns default to true so existing users are opted in to the
-- same emails they receive today (no silent behaviour change on deploy):
--   * security_alert_emails  — stale-key digest + leak-detection alerts.
--                              WIRED today: the senders skip admins who
--                              turned this off.
--   * marketing_emails       — product marketing / launch emails. A consent
--                              record honoured by future marketing sends;
--                              no such sender exists yet.
--   * product_update_emails  — changelog / "what's new" emails. Same: stored
--                              now, honoured when that sender ships.
--
-- Writes go through the server's service-role client at
-- /api/v1/me/notification-prefs (JWT). Users may read only their own row;
-- there are deliberately no INSERT/UPDATE/DELETE policies for the
-- authenticated role (deny-by-default), mirroring user_consents.

CREATE TABLE user_notification_prefs (
  user_id               UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

  security_alert_emails BOOLEAN NOT NULL DEFAULT true,
  marketing_emails      BOOLEAN NOT NULL DEFAULT true,
  product_update_emails BOOLEAN NOT NULL DEFAULT true,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE user_notification_prefs ENABLE ROW LEVEL SECURITY;

-- Users may read their own preferences.
CREATE POLICY "user_notif_prefs_select_own" ON user_notification_prefs
  FOR SELECT USING (user_id = auth.uid());

-- No INSERT/UPDATE/DELETE policies: all writes go through the server's
-- service-role client, which bypasses RLS. Authenticated/anon roles are
-- denied by default.

CREATE TRIGGER user_notification_prefs_updated_at BEFORE UPDATE ON user_notification_prefs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
