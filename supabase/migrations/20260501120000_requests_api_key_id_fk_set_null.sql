-- Change requests.api_key_id FK from NO ACTION to SET NULL
-- so that deleting an api_key preserves request history (api_key_id becomes NULL)
ALTER TABLE requests
  DROP CONSTRAINT requests_api_key_id_fkey;

ALTER TABLE requests
  ADD CONSTRAINT requests_api_key_id_fkey
  FOREIGN KEY (api_key_id) REFERENCES api_keys(id) ON DELETE SET NULL;
