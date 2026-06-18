-- Migration: allow 'dpa' in user_consents.document
--
-- The original 20260518100000_user_consents.sql CHECK constraint only allowed
-- ('terms', 'privacy'). docs/legal-compliance-update added a DPA document and
-- signup now posts {document: 'dpa', version: DPA_VERSION} alongside terms +
-- privacy. Without this migration the server-side ALLOWED_DOCUMENTS gate
-- rejects the batch (HTTP 400), and because the client fetch().catch() does
-- not fire on HTTP errors, the entire consent batch (including terms +
-- privacy) silently fails to record — breaking the audit log for every new
-- signup.
--
-- Idempotent: drops the legacy constraint by name then re-adds it with the
-- expanded allow-list.

ALTER TABLE user_consents
  DROP CONSTRAINT IF EXISTS user_consents_document_check;

ALTER TABLE user_consents
  ADD CONSTRAINT user_consents_document_check
  CHECK (document IN ('terms', 'privacy', 'dpa'));
