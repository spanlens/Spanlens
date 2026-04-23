-- Track which provider_keys row authenticated each upstream call.
-- An org may have multiple keys per provider over time (rotation, A/B,
-- multi-account); this column lets the dashboard show
-- "openai (prod-key-2)" instead of just "openai" so the user knows which
-- credential was used.
--
-- Nullable: existing historical rows have no value, and proxy fallbacks
-- (e.g. self-host with environment-variable key, no provider_keys row) may
-- not have one. ON DELETE SET NULL preserves the request log when a key is
-- revoked.

ALTER TABLE requests
  ADD COLUMN IF NOT EXISTS provider_key_id UUID REFERENCES provider_keys(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS requests_provider_key_idx
  ON requests (provider_key_id)
  WHERE provider_key_id IS NOT NULL;
