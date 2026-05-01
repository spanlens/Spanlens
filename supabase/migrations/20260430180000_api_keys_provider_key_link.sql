-- Link api_keys to a specific provider_key row.
-- When set, the proxy bypasses org/project key search and uses this key directly.
-- Nullable for backward compatibility with existing keys.
ALTER TABLE api_keys
  ADD COLUMN provider_key_id uuid REFERENCES provider_keys(id) ON DELETE SET NULL;

-- Index for the FK (Postgres doesn't auto-create FK indexes)
CREATE INDEX idx_api_keys_provider_key_id ON api_keys(provider_key_id)
  WHERE provider_key_id IS NOT NULL;
