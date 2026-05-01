-- Allow api_key_id to be NULL so deleted keys don't block request history
ALTER TABLE requests ALTER COLUMN api_key_id DROP NOT NULL;
