-- Migration: notification_channels_label
--
-- Adds an optional human-readable label to notification channels so a
-- workspace can run MULTIPLE channels of the same kind (e.g. two Slack
-- webhooks, "#prod-alerts" and "#oncall") and tell them apart in the UI.
--
-- Until now the Integrations UI collapsed each kind to a single boolean
-- ("Slack connected: yes/no"), even though the table already allowed many
-- rows per kind. Surfacing them as a list means raw webhook URLs would be
-- the only distinguisher, which are unreadable and partially secret. The
-- label fixes that; it is nullable so existing rows and the email kind
-- (where the address is already readable) need no backfill.

ALTER TABLE notification_channels
  ADD COLUMN IF NOT EXISTS label TEXT;
