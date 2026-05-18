-- Migration: user_consents
-- Immutable audit trail of each user's acceptance of the Terms of Service
-- and Privacy Policy at signup (and on subsequent re-acceptance prompts
-- when those documents are revised).
--
-- Why a dedicated table rather than auth.users.raw_user_meta_data:
--   1. user_meta_data is mutable — for legal record-keeping we want
--      append-only history. A consent dispute hinges on being able to
--      prove "this user accepted version X at time Y from IP Z".
--   2. We want IP + user-agent at the moment of acceptance, captured
--      server-side from the request — neither belongs in auth metadata.
--   3. Re-acceptance prompts (when Terms or Privacy is revised) need
--      multiple rows per user; metadata would need a manual journal.
--
-- The version column matches the EFFECTIVE_DATE string at the top of
-- the corresponding legal page (e.g. "2026-05-18" for Privacy Policy
-- v2026-05-18). Update both at the same time when revising a document.

CREATE TABLE user_consents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Which document was accepted. New documents (e.g. 'dpa') can be
  -- added without a schema change.
  document     TEXT NOT NULL
                 CHECK (document IN ('terms', 'privacy')),

  -- Version of the document accepted — matches EFFECTIVE_DATE on the page.
  version      TEXT NOT NULL,

  accepted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Captured by the server at the moment of acceptance, NOT supplied
  -- by the client. inet/text rather than jsonb because we want simple
  -- indexable equality lookups for fraud/dispute investigation.
  ip_address   INET,
  user_agent   TEXT
);

-- Lookup: "what did user X accept and when".
CREATE INDEX user_consents_user_doc_idx
  ON user_consents (user_id, document, accepted_at DESC);

-- Append-only invariant — no UPDATE / DELETE policy means no role can
-- modify a recorded consent. Service-role bypasses RLS for inserts,
-- which is what the server endpoint uses; users cannot rewrite history.
ALTER TABLE user_consents ENABLE ROW LEVEL SECURITY;

-- Users may read their own consent history (for a future "show me what
-- I accepted" UI). They cannot read anyone else's.
CREATE POLICY "user_consents_select_own" ON user_consents
  FOR SELECT USING (user_id = auth.uid());

-- Deliberately no INSERT / UPDATE / DELETE policies for the
-- anon/authenticated roles. All writes go through the server's
-- service-role client at /api/v1/me/consent.
